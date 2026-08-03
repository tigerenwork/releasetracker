'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Plus, Trash2 } from 'lucide-react';
import {
  parseConfigMapContent,
  serializeConfigMapContent,
} from '@/lib/configmap-content';

interface ConfigMapContentEditorProps {
  value: string;
  onChange: (v: string) => void;
}

type SetRow = { key: string; value: string };
type Mode = 'structured' | 'raw';

const RAW_PLACEHOLDER = 'KEY=VALUE\n-OLD_KEY  # prefix with - to delete';

/**
 * Controlled editor for `configmap` step content. Toggles between a
 * structured key-value editor and raw text; every structured edit
 * re-serializes and calls onChange.
 */
export function ConfigMapContentEditor({ value, onChange }: ConfigMapContentEditorProps) {
  const [mode, setMode] = useState<Mode>('structured');
  const [initial] = useState(() => parseConfigMapContent(value));
  const [setRows, setSetRows] = useState<SetRow[]>(() =>
    Object.entries(initial.set).map(([key, value]) => ({ key, value }))
  );
  const [delRows, setDelRows] = useState<string[]>(() => initial.delete);
  // Lines that can't be represented in the structured editor are kept and
  // appended back as `# unparsed:` comments on every serialize, so user text
  // is never lost. On mount, recover lines preserved by a previous session.
  const [preserved, setPreserved] = useState<string[]>(() => [
    ...initial.invalid.map((i) => i.line),
    ...value
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.startsWith('# unparsed: '))
      .map((l) => l.slice('# unparsed: '.length)),
  ]);

  const emit = (sets: SetRow[], dels: string[], keep: string[]) => {
    const base = serializeConfigMapContent(sets, dels);
    const preservedLines = keep.map((l) => `# unparsed: ${l}`);
    onChange([base, ...preservedLines].filter(Boolean).join('\n'));
  };

  const updateSetRow = (index: number, patch: Partial<SetRow>) => {
    const next = setRows.map((row, i) => (i === index ? { ...row, ...patch } : row));
    setSetRows(next);
    emit(next, delRows, preserved);
  };

  const removeSetRow = (index: number) => {
    const next = setRows.filter((_, i) => i !== index);
    setSetRows(next);
    emit(next, delRows, preserved);
  };

  const addSetRow = () => {
    setSetRows([...setRows, { key: '', value: '' }]);
  };

  const updateDelRow = (index: number, key: string) => {
    const next = delRows.map((row, i) => (i === index ? key : row));
    setDelRows(next);
    emit(setRows, next, preserved);
  };

  const removeDelRow = (index: number) => {
    const next = delRows.filter((_, i) => i !== index);
    setDelRows(next);
    emit(setRows, next, preserved);
  };

  const addDelRow = () => {
    setDelRows([...delRows, '']);
  };

  const switchMode = (next: Mode) => {
    if (next === mode) return;
    if (next === 'structured') {
      // Re-parse the raw text; invalid lines stay visible (and preserved).
      // `# unparsed:` comments from earlier serializes are already tracked in
      // `preserved`, so only newly invalid lines are added here.
      const parsed = parseConfigMapContent(value);
      setSetRows(Object.entries(parsed.set).map(([key, value]) => ({ key, value })));
      setDelRows(parsed.delete);
      const newlyInvalid = parsed.invalid.map((i) => i.line);
      if (newlyInvalid.length > 0) setPreserved([...preserved, ...newlyInvalid]);
    }
    setMode(next);
  };

  return (
    <div className="space-y-3">
      <div className="flex gap-1">
        <Button
          type="button"
          size="sm"
          variant={mode === 'structured' ? 'default' : 'outline'}
          onClick={() => switchMode('structured')}
        >
          Key-value editor
        </Button>
        <Button
          type="button"
          size="sm"
          variant={mode === 'raw' ? 'default' : 'outline'}
          onClick={() => switchMode('raw')}
        >
          Raw text
        </Button>
      </div>

      {mode === 'raw' ? (
        <Textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={RAW_PLACEHOLDER}
          className="font-mono min-h-[200px]"
          spellCheck={false}
        />
      ) : (
        <div className="space-y-3">
          {/* Set / update variables */}
          <div className="space-y-2">
            <p className="text-sm font-medium text-slate-500">Set / update variables</p>
            {setRows.map((row, i) => (
              <div key={i} className="flex items-center gap-2">
                <Input
                  value={row.key}
                  onChange={(e) => updateSetRow(i, { key: e.target.value })}
                  placeholder="KEY"
                  className="font-mono text-xs w-44 shrink-0"
                  spellCheck={false}
                />
                <Input
                  value={row.value}
                  onChange={(e) => updateSetRow(i, { value: e.target.value })}
                  placeholder="value"
                  className="font-mono text-xs flex-1"
                  spellCheck={false}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 shrink-0 text-red-600 hover:text-red-700"
                  title="Remove row"
                  onClick={() => removeSetRow(i)}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
            <Button type="button" variant="outline" size="sm" onClick={addSetRow}>
              <Plus className="h-4 w-4 mr-1" />
              Add variable
            </Button>
          </div>

          {/* Delete keys — kept visually separate: deletes are dangerous and
              must not be confused with sets */}
          <div className="space-y-2 bg-amber-50 border border-amber-200 rounded-md p-3">
            <p className="text-sm font-medium text-amber-700">
              Delete keys (removed from the ConfigMap on apply)
            </p>
            {delRows.map((key, i) => (
              <div key={i} className="flex items-center gap-2">
                <span className="text-amber-700 font-mono text-xs shrink-0">-</span>
                <Input
                  value={key}
                  onChange={(e) => updateDelRow(i, e.target.value)}
                  placeholder="KEY_TO_DELETE"
                  className="font-mono text-xs w-44 shrink-0 bg-white"
                  spellCheck={false}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 shrink-0 text-red-600 hover:text-red-700"
                  title="Remove row"
                  onClick={() => removeDelRow(i)}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
            <Button type="button" variant="outline" size="sm" onClick={addDelRow}>
              <Plus className="h-4 w-4 mr-1" />
              Add key to delete
            </Button>
          </div>

          {preserved.length > 0 && (
            <div className="p-3 bg-amber-50 text-amber-700 rounded-md text-sm space-y-1">
              <p className="font-medium">
                Some lines couldn&apos;t be parsed and will be kept as comments:
              </p>
              {preserved.map((line, i) => (
                <p key={i} className="font-mono text-xs">
                  {line}
                </p>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
