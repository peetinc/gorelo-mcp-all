#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

import { loadConfig } from './config.js';
import { buildTools } from './openapi.js';
import { callTool } from './gorelo-client.js';
import { applyFilters, FilterError } from './filter.js';
import type { OASpec, ToolDef } from './types.js';

const VERSION = '0.1.0';

function locateSpec(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    process.env.GORELO_SWAGGER_PATH,
    resolve(process.cwd(), 'swagger.json'),
    resolve(here, '..', 'swagger.json'),
    resolve(here, 'swagger.json'),
  ].filter(Boolean) as string[];
  for (const p of candidates) {
    try {
      readFileSync(p, 'utf8');
      return p;
    } catch {
      // not found, continue
    }
  }
  throw new Error(`Could not locate swagger.json. Tried: ${candidates.join(', ')}`);
}

async function main(): Promise<void> {
  const config = loadConfig();

  const specPath = locateSpec();
  const spec = JSON.parse(readFileSync(specPath, 'utf8')) as OASpec;
  const allTools = buildTools(spec);

  const filterResult = applyFilters(allTools, {
    preset: config.preset,
    enableTags: config.enableTags,
    disableTags: config.disableTags,
    readonly: config.readonly,
    disabledOperations: config.disabledOperations,
  });

  const tools = filterResult.tools;
  const toolMap = new Map<string, ToolDef>(tools.map((t) => [t.name, t]));

  const server = new Server(
    { name: 'gorelo-mcp-all', version: VERSION },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: tools.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const tool = toolMap.get(req.params.name);
    if (!tool) {
      return {
        isError: true,
        content: [{ type: 'text', text: `Unknown tool: ${req.params.name}` }],
      };
    }
    try {
      const result = await callTool(tool, req.params.arguments, config);
      const payload: Record<string, unknown> = {
        status: result.status,
        ok: result.ok,
        contentType: result.contentType,
        body: result.body,
      };
      if (result.truncated) {
        payload.truncated = true;
        payload.originalBytes = result.originalBytes;
      }
      if (result.retries) payload.retries = result.retries;
      if (result.binary) payload.binary = result.binary;
      return {
        isError: !result.ok,
        content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }],
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { isError: true, content: [{ type: 'text', text: `Error: ${message}` }] };
    }
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);

  const applied = filterResult.applied;
  process.stderr.write(
    `[gorelo-mcp-all v${VERSION}] loaded ${tools.length}/${allTools.length} tools from ${specPath}\n` +
      `[gorelo-mcp-all] preset=${applied.preset ?? '-'} ` +
      `enable_tags=${applied.enableTags.join(',') || '-'} ` +
      `disable_tags=${applied.disableTags.join(',') || '-'} ` +
      `readonly=${applied.readonly} disabled_ops=${applied.disabledOperations}\n` +
      `[gorelo-mcp-all] base=${config.baseUrl} maxRetries=${config.maxRetries} ` +
      `maxResponseBytes=${config.maxResponseBytes}\n`
  );
  for (const w of filterResult.warnings) {
    process.stderr.write(`[gorelo-mcp-all] warn: ${w}\n`);
  }
}

main().catch((err) => {
  if (err instanceof FilterError) {
    process.stderr.write(`[gorelo-mcp-all] config error: ${err.message}\n`);
    process.exit(2);
  }
  process.stderr.write(`[gorelo-mcp-all] fatal: ${err instanceof Error ? err.stack : String(err)}\n`);
  process.exit(1);
});
