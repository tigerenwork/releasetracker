'use client';

import { useRef, type ReactNode, type UIEvent } from 'react';

// Minimal JSON tokenizer: strings (keys vs values), numbers, booleans, null.
// Everything else (punctuation, whitespace) is left unstyled.
const TOKEN_RE =
  /("(?:\\.|[^"\\])*")(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g;

function highlightJson(src: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let last = 0;
  let key = 0;
  for (const m of src.matchAll(TOKEN_RE)) {
    if (m.index > last) nodes.push(src.slice(last, m.index));
    const [full, str, colon, keyword] = m;
    let className = 'text-amber-700'; // number
    if (str) className = colon ? 'text-purple-700' : 'text-green-700';
    else if (keyword) className = 'text-blue-700';
    nodes.push(
      <span key={key++} className={className}>
        {full}
      </span>
    );
    last = m.index + full.length;
  }
  if (last < src.length) nodes.push(src.slice(last));
  return nodes;
}

interface JsonEditorProps {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  className?: string;
}

/**
 * Textarea with JSON syntax highlighting: a highlighted <pre> sits behind a
 * transparent-text textarea (caret stays visible). Font metrics, padding and
 * wrapping must match exactly between the two layers.
 */
export function JsonEditor({ id, value, onChange, className }: JsonEditorProps) {
  const preRef = useRef<HTMLPreElement>(null);

  const syncScroll = (e: UIEvent<HTMLTextAreaElement>) => {
    if (!preRef.current) return;
    preRef.current.scrollTop = e.currentTarget.scrollTop;
    preRef.current.scrollLeft = e.currentTarget.scrollLeft;
  };

  return (
    <div
      className={`relative rounded-md border border-input shadow-xs focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50 ${className ?? ''}`}
    >
      <pre
        ref={preRef}
        aria-hidden
        className="pointer-events-none absolute inset-0 overflow-hidden whitespace-pre-wrap break-words px-3 py-2 font-mono text-xs leading-5"
      >
        {highlightJson(value)}
        {/* trailing newline keeps the last line's height in sync */}
        {'\n'}
      </pre>
      <textarea
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onScroll={syncScroll}
        spellCheck={false}
        className="relative h-40 w-full resize-none overflow-auto bg-transparent px-3 py-2 font-mono text-xs leading-5 text-transparent caret-slate-900 outline-none selection:bg-blue-200/60"
      />
    </div>
  );
}
