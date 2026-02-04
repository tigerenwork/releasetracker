'use client';

import { useState, useMemo } from 'react';
import { Copy, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface CodeBlockProps {
  code: string;
  type: 'bash' | 'sql' | 'text' | 'branch';
  showLineNumbers?: boolean;
}

export function CodeBlock({ code, type, showLineNumbers = true }: CodeBlockProps) {
  const [copied, setCopied] = useState(false);

  // Compute highlighted code synchronously
  const highlighted = useMemo(() => {
    if (!code) return '';
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const Prism = require('prismjs');
      
      if (type === 'sql') {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        require('prismjs/components/prism-sql');
      } else if (type === 'bash') {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        require('prismjs/components/prism-bash');
      }

      const language = type === 'text' || type === 'branch' ? 'text' : type;
      const grammar = Prism.languages[language] || Prism.languages.text;
      return Prism.highlight(code, grammar, language);
    } catch (e) {
      return code.replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }
  }, [code, type]);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Split code into lines for line numbers
  const lines = code ? code.split('\n') : [];
  const highlightedLines = highlighted ? highlighted.split('\n') : [];

  return (
    <div 
      className="rounded-lg bg-slate-900 p-4 text-sm overflow-x-auto"
      style={{ maxWidth: '100%' }}
    >
      <pre className={`language-${type} m-0`} style={{ minWidth: '100%' }}>
        {showLineNumbers ? (
          <div className="flex" style={{ minWidth: 0 }}>
            {/* Line numbers column - fixed width */}
            <div className="flex flex-col text-slate-500 text-right pr-4 select-none w-12 shrink-0">
              {lines.map((_: string, i: number) => (
                <span key={i}>{i + 1}</span>
              ))}
            </div>
            {/* Code column */}
            <div className="flex flex-col" style={{ minWidth: 0 }}>
              {highlightedLines.map((line: string, i: number) => (
                <span 
                  key={i} 
                  className="text-slate-100 whitespace-pre"
                  dangerouslySetInnerHTML={{ __html: line || ' ' }}
                />
              ))}
            </div>
          </div>
        ) : (
          <code 
            className="text-slate-100 whitespace-pre"
            dangerouslySetInnerHTML={{ __html: highlighted || code || '' }}
          />
        )}
      </pre>
    </div>
  );
}
