'use client';

import { useState } from 'react';

const PREVIEW_LINES = 8;

/**
 * Release descriptions can be pages long; show the first few lines
 * with an expand/collapse toggle.
 */
export function ReleaseDescription({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false);

  const lines = text.split('\n');
  const collapsible = lines.length > PREVIEW_LINES;

  return (
    <div>
      <p className="text-slate-900 mt-1 whitespace-pre-wrap">
        {expanded || !collapsible ? text : lines.slice(0, PREVIEW_LINES).join('\n')}
      </p>
      {collapsible && (
        <button
          className="text-sm text-blue-600 hover:text-blue-800 mt-1"
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? 'Show less' : `Show more (${lines.length - PREVIEW_LINES} more lines)`}
        </button>
      )}
    </div>
  );
}
