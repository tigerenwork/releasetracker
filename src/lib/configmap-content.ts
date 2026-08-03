/**
 * Parser/serializer for the `configmap` step content format.
 *
 * Format: one entry per line.
 *   KEY=VALUE   set (or overwrite) a key in the ConfigMap
 *   -KEY        delete a key from the ConfigMap
 * Blank lines and lines starting with '#' are ignored. Lines are split on
 * the FIRST '='. Keys must match /^[-._a-zA-Z0-9]+$/ (after stripping the
 * '-' delete prefix) — the agent enforces the same allowlist.
 *
 * Pure functions, usable from client components.
 */

export interface ConfigMapInvalidLine {
  line: string;
  reason: string;
}

export interface ConfigMapContent {
  set: Record<string, string>;
  delete: string[];
  invalid: ConfigMapInvalidLine[];
}

// ConfigMap data keys — the agent enforces the same allowlist
const KEY_RE = /^[-._a-zA-Z0-9]+$/;

export function parseConfigMapContent(text: string): ConfigMapContent {
  const set: Record<string, string> = {};
  const del: string[] = [];
  const invalid: ConfigMapInvalidLine[] = [];

  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;

    if (line.startsWith('-')) {
      const key = line.slice(1).trim();
      if (!KEY_RE.test(key)) {
        invalid.push({ line, reason: `invalid delete key "${key}"` });
        continue;
      }
      // Last write wins: a delete cancels an earlier set of the same key
      delete set[key];
      if (!del.includes(key)) del.push(key);
      continue;
    }

    const eq = line.indexOf('=');
    if (eq === -1) {
      invalid.push({ line, reason: 'no = separator (prefix with - to delete a key)' });
      continue;
    }
    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1);
    if (!KEY_RE.test(key)) {
      invalid.push({ line, reason: `invalid key "${key}"` });
      continue;
    }
    // Last write wins: a set cancels an earlier delete of the same key
    const delIdx = del.indexOf(key);
    if (delIdx !== -1) del.splice(delIdx, 1);
    set[key] = value;
  }

  return { set, delete: del, invalid };
}

/**
 * Canonical text emitted by the structured editor: set lines first, then
 * -KEY delete lines. Rows with empty keys are dropped.
 */
export function serializeConfigMapContent(
  set: Array<{ key: string; value: string }>,
  del: string[]
): string {
  const setLines = set
    .filter((row) => row.key.trim())
    .map((row) => `${row.key.trim()}=${row.value}`);
  const delLines = del.map((k) => k.trim()).filter(Boolean).map((k) => `-${k}`);
  return [...setLines, ...delLines].join('\n');
}
