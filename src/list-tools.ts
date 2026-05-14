import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildTools } from './openapi.js';
import type { OASpec } from './types.js';

const here = dirname(fileURLToPath(import.meta.url));
const path = resolve(here, '..', 'swagger.json');
const spec = JSON.parse(readFileSync(path, 'utf8')) as OASpec;
const tools = buildTools(spec);

console.log(`Total tools: ${tools.length}\n`);
for (const t of tools) {
  console.log(`${t.method.padEnd(6)} ${t.name.padEnd(45)} ${t.pathTemplate}`);
}
