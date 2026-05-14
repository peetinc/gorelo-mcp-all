import type { OAOperation, OAParam, OARequestBody, OASchema, OASpec, ToolDef } from './types.js';

const HTTP_METHODS = ['get', 'post', 'put', 'patch', 'delete'] as const;

function resolveRef(spec: OASpec, ref: string): OASchema | null {
  // "#/components/schemas/Foo" or "#/definitions/Foo"
  if (!ref.startsWith('#/')) return null;
  const parts = ref.slice(2).split('/');
  let cur: unknown = spec;
  for (const p of parts) {
    if (cur && typeof cur === 'object' && p in (cur as Record<string, unknown>)) {
      cur = (cur as Record<string, unknown>)[p];
    } else {
      return null;
    }
  }
  return cur as OASchema;
}

function inlineRefs(schema: OASchema | undefined, spec: OASpec, depth = 0): OASchema {
  if (!schema || depth > 6) return schema ?? {};
  if (schema.$ref) {
    const resolved = resolveRef(spec, schema.$ref);
    if (resolved) return inlineRefs(resolved, spec, depth + 1);
    return { type: 'object', description: `Unresolved $ref: ${schema.$ref}` };
  }
  const out: OASchema = { ...schema };
  if (schema.properties) {
    out.properties = {};
    for (const [k, v] of Object.entries(schema.properties)) {
      out.properties[k] = inlineRefs(v, spec, depth + 1);
    }
  }
  if (schema.items) out.items = inlineRefs(schema.items, spec, depth + 1);
  if (schema.allOf) out.allOf = schema.allOf.map((s) => inlineRefs(s, spec, depth + 1));
  if (schema.oneOf) out.oneOf = schema.oneOf.map((s) => inlineRefs(s, spec, depth + 1));
  if (schema.anyOf) out.anyOf = schema.anyOf.map((s) => inlineRefs(s, spec, depth + 1));
  return out;
}

function paramSchema(p: OAParam, spec: OASpec): OASchema {
  if (p.schema) return inlineRefs(p.schema, spec);
  return { type: 'string', description: p.description };
}

function pickBodyContent(rb: OARequestBody | undefined): { schema?: OASchema; contentType?: string } {
  if (!rb || !rb.content) return {};
  const preferred = [
    'application/json',
    'application/x-www-form-urlencoded',
    'multipart/form-data',
    'text/plain',
  ];
  for (const ct of preferred) {
    if (rb.content[ct]) return { schema: rb.content[ct].schema, contentType: ct };
  }
  const entries = Object.entries(rb.content);
  if (entries.length === 0) return {};
  const [firstCt, firstSpec] = entries[0];
  return { schema: firstSpec.schema, contentType: firstCt };
}

function looksLikeGeneratedOperationId(id: string): boolean {
  // Gorelo emits placeholder operationIds like "crm-cluster_", "asset-cluster_",
  // "ticket-cluster_", "serviceprovider-cluster_" that collide across endpoints
  // and don't describe the action. Treat as missing.
  return /-cluster_?$/.test(id) || id.endsWith('_') || !/[a-zA-Z]/.test(id);
}

function pathToToolSuffix(method: string, path: string): string {
  const cleanedPath = path
    .replace(/^\//, '')
    .replace(/\{([^}]+)\}/g, '$1')
    .replace(/[\/.]/g, '_');
  return `${method}_${cleanedPath}`;
}

function deriveToolName(operationId: string | undefined, method: string, path: string): string {
  if (operationId && operationId.trim() && !looksLikeGeneratedOperationId(operationId)) {
    return operationId.replace(/[^A-Za-z0-9_-]/g, '_');
  }
  return pathToToolSuffix(method, path);
}

export function buildTools(spec: OASpec): ToolDef[] {
  const tools: ToolDef[] = [];

  for (const [pathTemplate, methods] of Object.entries(spec.paths ?? {})) {
    for (const method of HTTP_METHODS) {
      const op = (methods as Record<string, OAOperation>)[method];
      if (!op) continue;

      const params = op.parameters ?? [];
      const pathParams = params.filter((p) => p.in === 'path');
      const queryParams = params.filter((p) => p.in === 'query');
      const headerParams = params.filter((p) => p.in === 'header');

      const properties: Record<string, OASchema> = {};
      const required: string[] = [];

      for (const p of [...pathParams, ...queryParams, ...headerParams]) {
        properties[p.name] = paramSchema(p, spec);
        if (p.required) required.push(p.name);
      }

      const { schema: bodySchema, contentType: bodyContentType } = pickBodyContent(op.requestBody);
      if (bodySchema) {
        properties.body = {
          ...inlineRefs(bodySchema, spec),
          description: op.requestBody?.description ?? 'Request body',
        };
        if (op.requestBody?.required) required.push('body');
      }

      const description = [
        op.summary,
        op.description,
        op.tags?.length ? `Tag: ${op.tags.join(', ')}` : undefined,
        `${method.toUpperCase()} ${pathTemplate}`,
      ]
        .filter(Boolean)
        .join(' — ');

      const inputSchema: Record<string, unknown> = {
        type: 'object',
        properties,
        ...(required.length ? { required } : {}),
        additionalProperties: false,
      };

      const toolName = deriveToolName(op.operationId, method, pathTemplate);

      tools.push({
        name: toolName,
        description,
        inputSchema,
        method: method.toUpperCase(),
        pathTemplate,
        pathParams: pathParams.map((p) => p.name),
        queryParams: queryParams.map((p) => p.name),
        headerParams: headerParams.map((p) => p.name),
        bodyParam: bodySchema ? 'body' : undefined,
        bodyContentType,
        tags: op.tags ?? [],
      });
    }
  }

  // Deduplicate tool names — when operationId is reused or missing, append method+path suffix.
  const seen = new Set<string>();
  for (const t of tools) {
    if (seen.has(t.name)) {
      t.name = `${t.method.toLowerCase()}_${t.pathTemplate
        .replace(/^\//, '')
        .replace(/\{([^}]+)\}/g, '$1')
        .replace(/[\/.]/g, '_')}`;
    }
    seen.add(t.name);
  }

  if (!tools.some((t) => t.name === 'gorelo_test_connection')) {
    // Prefer a known-small enumeration endpoint for the ping so the response
    // stays under MCP transport limits. Fall back to first GET with no path
    // params, then first GET at all.
    const SMALL_PING_PATHS = [
      '/v1/tickets/statuses',
      '/v1/tickets/types',
      '/v1/organization/groups',
      '/v1/tickets/tags',
    ];
    let ping = tools.find(
      (t) => t.method === 'GET' && SMALL_PING_PATHS.includes(t.pathTemplate)
    );
    if (!ping) ping = tools.find((t) => t.method === 'GET' && t.pathParams.length === 0);
    if (!ping) ping = tools.find((t) => t.method === 'GET');
    if (ping) {
      tools.push({
        name: 'gorelo_test_connection',
        description:
          "Test connection and credentials against the configured Gorelo instance. — GET " +
          ping.pathTemplate,
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
        method: 'GET',
        pathTemplate: ping.pathTemplate,
        pathParams: ping.pathParams,
        queryParams: [],
        headerParams: [],
        bodyParam: undefined,
        bodyContentType: undefined,
        tags: ['Diagnostics'],
        synthetic: true,
      });
    }
  }

  return tools;
}
