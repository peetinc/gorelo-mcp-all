import type { ToolDef } from './types.js';
import { PRESETS, normalizeTag, listPresets, type PresetSpec } from './presets.js';

export type FilterConfig = {
  preset?: string;
  enableTags: string[];
  disableTags: string[];
  readonly: boolean;
  disabledOperations: Set<string>;
};

export type FilterResult = {
  tools: ToolDef[];
  warnings: string[];
  applied: {
    preset: string | null;
    enableTags: string[];
    disableTags: string[];
    readonly: boolean;
    disabledOperations: number;
  };
};

export class FilterError extends Error {}

function buildNormalizedTagSet(allTools: ToolDef[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const t of allTools) {
    for (const tag of t.tags) map.set(normalizeTag(tag), tag);
  }
  return map;
}

function resolveTags(
  input: string[],
  knownTags: Map<string, string>,
  warnings: string[],
  source: string
): Set<string> {
  const out = new Set<string>();
  for (const raw of input) {
    const norm = normalizeTag(raw);
    if (!norm) continue;
    const canonical = knownTags.get(norm);
    if (canonical) {
      out.add(canonical);
    } else {
      warnings.push(
        `Unknown tag in ${source}: '${raw}' — ignored. Known tags: ${[...knownTags.values()]
          .sort()
          .join(', ')}`
      );
    }
  }
  return out;
}

function presetTags(spec: PresetSpec, knownTags: Map<string, string>): Set<string> | null {
  if (spec.kind === 'all' || spec.kind === 'readonly') return null;
  const out = new Set<string>();
  for (const t of spec.tags) {
    const canonical = knownTags.get(normalizeTag(t));
    if (canonical) out.add(canonical);
  }
  return out;
}

export function applyFilters(allTools: ToolDef[], config: FilterConfig): FilterResult {
  const warnings: string[] = [];
  const knownTags = buildNormalizedTagSet(allTools);

  let presetName: string | null = null;
  let presetTagSet: Set<string> | null = null;
  let presetIsReadonly = false;

  if (config.preset) {
    const key = config.preset.toLowerCase().trim();
    const spec = PRESETS[key];
    if (!spec) {
      throw new FilterError(
        `Unknown GORELO_PRESET='${config.preset}'. Valid presets: ${listPresets().join(', ')}`
      );
    }
    presetName = key;
    presetIsReadonly = spec.kind === 'readonly';
    presetTagSet = presetTags(spec, knownTags);
  }

  const enableSet = resolveTags(config.enableTags, knownTags, warnings, 'GORELO_ENABLE_TAGS');
  const disableSet = resolveTags(config.disableTags, knownTags, warnings, 'GORELO_DISABLE_TAGS');
  const effectiveReadonly = config.readonly || presetIsReadonly;

  const kept: ToolDef[] = [];
  for (const t of allTools) {
    if (t.synthetic) {
      kept.push(t);
      continue;
    }
    if (presetTagSet && !t.tags.some((tag) => presetTagSet!.has(tag))) continue;
    if (enableSet.size > 0 && !t.tags.some((tag) => enableSet.has(tag))) continue;
    if (disableSet.size > 0 && t.tags.some((tag) => disableSet.has(tag))) continue;
    if (effectiveReadonly && t.method !== 'GET') continue;
    if (config.disabledOperations.has(t.name)) continue;
    kept.push(t);
  }

  const nonSynthetic = kept.filter((t) => !t.synthetic).length;
  if (nonSynthetic === 0) {
    throw new FilterError(
      'Filter pipeline produced 0 Gorelo tools. Check GORELO_PRESET / GORELO_ENABLE_TAGS / GORELO_DISABLE_TAGS / GORELO_DISABLED_OPERATIONS.'
    );
  }

  return {
    tools: kept,
    warnings,
    applied: {
      preset: presetName,
      enableTags: [...enableSet],
      disableTags: [...disableSet],
      readonly: effectiveReadonly,
      disabledOperations: config.disabledOperations.size,
    },
  };
}
