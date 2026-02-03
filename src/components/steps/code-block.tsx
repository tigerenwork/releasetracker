'use client';

import { useState, useMemo } from 'react';
import { Copy, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface CodeBlockProps {
  code: string;
  type: 'bash' | 'sql' | 'text';
  showLineNumbers?: boolean;
}

export function CodeBlock({ code, type, showLineNumbers = true }: CodeBlockProps) {
  console.log('[CodeBlock] Render - code length:', code?.length, 'code preview:', code?.substring(0, 50), 'type:', type);
  
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

      const language = type === 'text' ? 'text' : type;
      const grammar = Prism.languages[language] || Prism.languages.text;
      return Prism.highlight(code, grammar, language);
    } catch (e) {
      console.error('[CodeBlock] Prism error:', e);
      return code.replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }
  }, [code, type]);

  console.log('[CodeBlock] highlighted length:', highlighted?.length);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Split code into lines for line numbers
  const lines = code ? code.split('\n') : [];
  const highlightedLines = highlighted ? highlighted.split('\n') : [];

  return (
    <div className="relative group">
      <Button
        variant="ghost"
        size="sm"
        className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity z-10"
        onClick={handleCopy}
      >
        {copied ? (
          <Check className="w-4 h-4 text-green-500" />
        ) : (
          <Copy className="w-4 h-4" />
        )}
      </Button>
      <div className="rounded-lg bg-slate-900 p-4 overflow-x-auto text-sm">
        <pre className={`language-${type} m-0`}>
          {showLineNumbers ? (
            <div className="flex">
              {/* Line numbers column */}
              <div className="flex flex-col text-slate-500 text-right pr-4 select-none min-w-[3rem]">
                {lines.map((_: string, i: number) => (
                  <span key={i}>{i + 1}</span>
                ))}
              </div>
              {/* Code column */}
              <div className="flex flex-col">
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
    </div>
  );
}
