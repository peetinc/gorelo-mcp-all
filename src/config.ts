import { readFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve } from 'node:path';

export type Config = {
  baseUrl: string;
  apiKey: string;
  disabledOperations: Set<string>;
  readonly: boolean;
  timeoutMs: number;
  maxRetries: number;
  maxResponseBytes: number;
  userAgentVersion: string;
  preset?: string;
  enableTags: string[];
  disableTags: string[];
};

const DEFAULT_MAX_RESPONSE_BYTES = 1_500_000;
const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_TIMEOUT_MS = 30_000;

function loadEnvFile(path: string): void {
  if (!existsSync(path)) return;
  const text = readFileSync(path, 'utf8');
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

function resolveApiKey(): string {
  const envKey = process.env.GORELO_API_KEY?.trim();
  if (envKey) return envKey;

  const filePath = process.env.GORELO_API_KEY_FILE?.trim();
  if (filePath) {
    const expanded = filePath.startsWith('~') ? filePath.replace(/^~/, homedir()) : filePath;
    if (!existsSync(expanded)) {
      throw new Error(`GORELO_API_KEY_FILE='${filePath}' does not exist (resolved to ${expanded})`);
    }
    const fromFile = readFileSync(expanded, 'utf8').trim();
    if (!fromFile) {
      throw new Error(`GORELO_API_KEY_FILE='${filePath}' is empty`);
    }
    return fromFile;
  }

  throw new Error('Gorelo API key required. Set GORELO_API_KEY or GORELO_API_KEY_FILE.');
}

function parseIntEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

function splitCsv(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

export function loadConfig(): Config {
  loadEnvFile(resolve(process.cwd(), '.env'));

  const baseUrl = (process.env.GORELO_BASE_URL ?? '').trim().replace(/\/$/, '');
  if (!baseUrl) {
    throw new Error('GORELO_BASE_URL is required (e.g. https://api.usw.gorelo.io)');
  }

  const apiKey = resolveApiKey();

  const disabledOperations = new Set(
    (process.env.GORELO_DISABLED_OPERATIONS ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
  );

  const readonly = (process.env.GORELO_READONLY ?? 'false').toLowerCase() === 'true';

  return {
    baseUrl,
    apiKey,
    disabledOperations,
    readonly,
    timeoutMs: parseIntEnv('GORELO_TIMEOUT_MS', DEFAULT_TIMEOUT_MS),
    maxRetries: parseIntEnv('GORELO_MAX_RETRIES', DEFAULT_MAX_RETRIES),
    maxResponseBytes: parseIntEnv('GORELO_MAX_RESPONSE_BYTES', DEFAULT_MAX_RESPONSE_BYTES),
    userAgentVersion: '0.1.0',
    preset: process.env.GORELO_PRESET?.trim() || undefined,
    enableTags: splitCsv(process.env.GORELO_ENABLE_TAGS),
    disableTags: splitCsv(process.env.GORELO_DISABLE_TAGS),
  };
}
