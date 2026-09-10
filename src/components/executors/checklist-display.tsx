'use client';

import { useState } from 'react';
import { Checkbox } from '@/components/ui/checkbox';

export function parseChecklistItems(content: string): string[] {
  return content
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

interface ChecklistDisplayProps {
  stepId: number;
  /** Checklist items, one per line */
  content: string;
  /** Indexes of completed items (persisted per customer step) */
  checkedItems: number[] | null | undefined;
  readOnly?: boolean;
  onToggle?: (stepId: number, index: number, checked: boolean) => Promise<void>;
}

/**
 * Interactive checklist for `checklist` steps. Items come from the step
 * content (one per line); completion state is persisted per customer step.
 */
export function ChecklistDisplay({
  stepId,
  content,
  checkedItems,
  readOnly = false,
  onToggle,
}: ChecklistDisplayProps) {
  const items = parseChecklistItems(content);
  const checked = new Set(checkedItems ?? []);
  const doneCount = items.filter((_, i) => checked.has(i)).length;
  const [pending, setPending] = useState<number | null>(null);

  const handleToggle = async (index: number, value: boolean) => {
    if (!onToggle || pending !== null) return;
    setPending(index);
    try {
      await onToggle(stepId, index, value);
    } finally {
      setPending(null);
    }
  };

  return (
    <div className="space-y-2">
      <div className="space-y-1.5">
        {items.map((item, i) => (
          <label
            key={i}
            className={`flex items-start gap-2.5 rounded-md border px-3 py-2 text-sm ${
              checked.has(i) ? 'bg-green-50/50 border-green-200' : 'bg-white'
            } ${readOnly ? '' : 'cursor-pointer hover:bg-slate-50'}`}
          >
            <Checkbox
              checked={checked.has(i)}
              disabled={readOnly || pending === i}
              onCheckedChange={(v) => handleToggle(i, v === true)}
              className="mt-0.5"
            />
            <span className={checked.has(i) ? 'text-slate-400 line-through' : ''}>
              {item}
            </span>
          </label>
        ))}
      </div>
      <p className="text-xs text-slate-400">
        {doneCount}/{items.length} completed
      </p>
    </div>
  );
}
