export type PresetSpec =
  | { kind: 'all' }
  | { kind: 'readonly' }
  | { kind: 'tags'; tags: string[] };

// Gorelo tags (small surface, 6 total): Alerts, Assets, Clients, Contacts, Organization, Tickets
export const PRESETS: Record<string, PresetSpec> = {
  all: { kind: 'all' },
  readonly: { kind: 'readonly' },
  crm: { kind: 'tags', tags: ['Contacts', 'Clients', 'Organization'] },
  tickets: { kind: 'tags', tags: ['Tickets', 'Contacts', 'Clients'] },
  monitoring: { kind: 'tags', tags: ['Alerts', 'Assets'] },
};

export function listPresets(): string[] {
  return Object.keys(PRESETS).sort();
}

export function normalizeTag(t: string): string {
  return t.trim().toLowerCase().replace(/[\s_-]+/g, ' ');
}
