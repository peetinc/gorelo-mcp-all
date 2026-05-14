import type { Config } from './config.js';
import type { ToolDef } from './types.js';

export type CallResult = {
  ok: boolean;
  status: number;
  body: unknown;
  contentType: string | null;
  truncated?: boolean;
  originalBytes?: number;
  retries?: number;
  binary?: { encoding: 'base64'; data: string; bytes: number };
};

function fillPath(template: string, args: Record<string, unknown>, pathParams: string[]): string {
  let url = template;
  for (const name of pathParams) {
    const value = args[name];
    if (value === undefined || value === null || value === '') {
      throw new Error(`Missing required path parameter: ${name}`);
    }
    url = url.replace(`{${name}}`, encodeURIComponent(String(value)));
  }
  return url;
}

function buildQuery(args: Record<string, unknown>, queryParams: string[]): string {
  const sp = new URLSearchParams();
  for (const name of queryParams) {
    const value = args[name];
    if (value === undefined || value === null || value === '') continue;
    if (Array.isArray(value)) {
      for (const v of value) sp.append(name, String(v));
    } else {
      sp.append(name, String(value));
    }
  }
  const s = sp.toString();
  return s ? `?${s}` : '';
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function parseRetryAfter(header: string | null): number {
  if (!header) return 0;
  const asInt = Number.parseInt(header, 10);
  if (Number.isFinite(asInt) && asInt >= 0) return asInt * 1000;
  const asDate = Date.parse(header);
  if (Number.isFinite(asDate)) {
    const delta = asDate - Date.now();
    return delta > 0 ? delta : 0;
  }
  return 0;
}

function maybeTruncate(
  body: unknown,
  contentType: string | null,
  limit: number
): { body: unknown; truncated: boolean; originalBytes: number } {
  let serialized: string;
  if (typeof body === 'string') {
    serialized = body;
  } else {
    try {
      serialized = JSON.stringify(body);
    } catch {
      return { body, truncated: false, originalBytes: 0 };
    }
  }
  const bytes = Buffer.byteLength(serialized, 'utf8');
  if (bytes <= limit) return { body, truncated: false, originalBytes: bytes };

  const head = serialized.slice(0, Math.max(0, limit - 200));
  return {
    body: {
      __truncated: true,
      __original_bytes: bytes,
      __limit_bytes: limit,
      __content_type: contentType,
      preview: head,
    },
    truncated: true,
    originalBytes: bytes,
  };
}

export async function callTool(
  tool: ToolDef,
  rawArgs: unknown,
  config: Config
): Promise<CallResult> {
  if (config.disabledOperations.has(tool.name)) {
    throw new Error(`Operation '${tool.name}' is disabled via GORELO_DISABLED_OPERATIONS`);
  }
  if (config.readonly && tool.method === 'DELETE') {
    throw new Error(`Operation '${tool.name}' blocked: GORELO_READONLY=true forbids DELETE`);
  }

  const args = (rawArgs ?? {}) as Record<string, unknown>;

  const path = fillPath(tool.pathTemplate, args, tool.pathParams);
  const query = buildQuery(args, tool.queryParams);
  const url = `${config.baseUrl}${path}${query}`;

  const headers: Record<string, string> = {
    'X-API-Key': config.apiKey,
    accept: 'application/json',
    'user-agent': `gorelo-mcp-all/${config.userAgentVersion}`,
  };

  // Custom header params from spec (rare)
  for (const name of tool.headerParams) {
    const v = args[name];
    if (v !== undefined && v !== null) headers[name] = String(v);
  }

  let body: BodyInit | undefined;
  if (tool.bodyParam && args.body !== undefined) {
    const ct = tool.bodyContentType ?? 'application/json';
    headers['content-type'] = ct;
    if (ct === 'application/json') {
      body = JSON.stringify(args.body);
    } else if (ct === 'application/x-www-form-urlencoded') {
      const sp = new URLSearchParams();
      if (args.body && typeof args.body === 'object') {
        for (const [k, v] of Object.entries(args.body as Record<string, unknown>)) {
          if (v !== undefined && v !== null) sp.append(k, String(v));
        }
      }
      body = sp.toString();
    } else {
      body = typeof args.body === 'string' ? args.body : JSON.stringify(args.body);
    }
  }

  let response: Response | null = null;
  let retries = 0;

  for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), config.timeoutMs);
    try {
      response = await fetch(url, { method: tool.method, headers, body, signal: ac.signal });
    } finally {
      clearTimeout(t);
    }
    if (response.status !== 429) break;
    if (attempt === config.maxRetries) break;
    retries++;
    const retryAfterMs = parseRetryAfter(response.headers.get('retry-after'));
    const backoffMs = retryAfterMs || Math.min(1000 * 2 ** attempt, 15000);
    await sleep(backoffMs);
  }

  if (!response) throw new Error('No response received');

  const contentType = response.headers.get('content-type');
  let parsed: unknown;
  if (contentType && contentType.includes('application/json')) {
    parsed = await response.json().catch(() => null);
  } else if (contentType && (contentType.startsWith('text/') || contentType.includes('xml'))) {
    parsed = await response.text();
  } else if (!response.ok) {
    parsed = await response.text();
  } else {
    const ab = await response.arrayBuffer();
    const buf = Buffer.from(ab);
    return {
      ok: response.ok,
      status: response.status,
      contentType,
      body: { note: 'Binary response.', bytes: buf.byteLength },
      binary: { encoding: 'base64', data: buf.toString('base64'), bytes: buf.byteLength },
      retries,
    };
  }

  const { body: maybeTrunc, truncated, originalBytes } = maybeTruncate(
    parsed,
    contentType,
    config.maxResponseBytes
  );

  return {
    ok: response.ok,
    status: response.status,
    body: maybeTrunc,
    contentType,
    truncated,
    originalBytes,
    retries,
  };
}
