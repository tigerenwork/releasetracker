'use client';

import { useEffect, useState } from 'react';
import { Copy, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface CodeBlockProps {
  code: string;
  type: 'bash' | 'sql' | 'text';
  showLineNumbers?: boolean;
}

export function CodeBlock({ code, type, showLineNumbers = true }: CodeBlockProps) {
  const [highlighted, setHighlighted] = useState<string>('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    async function highlight() {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const Prism = require('prismjs');
      
      // Load language components dynamically
      if (type === 'sql') {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        require('prismjs/components/prism-sql');
      } else if (type === 'bash') {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        require('prismjs/components/prism-bash');
      }

      const language = type === 'text' ? 'text' : type;
      const grammar = Prism.languages[language] || Prism.languages.text;
      const highlightedCode = Prism.highlight(code, grammar, language);
      setHighlighted(highlightedCode);
    }

    highlight();
  }, [code, type]);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const lines = code.split('\n');

  return (
    <div className="relative group">
      <Button
        variant="ghost"
        size="sm"
        className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity"
        onClick={handleCopy}
      >
        {copied ? (
          <Check className="w-4 h-4 text-green-500" />
        ) : (
          <Copy className="w-4 h-4" />
        )}
      </Button>
      <pre className="rounded-lg bg-slate-900 p-4 overflow-x-auto text-sm">
        <code className="language-{type}">
          {showLineNumbers ? (
            <table className="border-collapse">
              <tbody>
                {lines.map((line, i) => (
                  <tr key={i}>
                    <td className="text-slate-500 text-right pr-4 select-none w-12">
                      {i + 1}
                    </td>
                    <td 
                      className="text-slate-100"
                      dangerouslySetInnerHTML={{ 
                        __html: highlighted 
                          ? highlighted.split('\n')[i] || ''
                          : line 
                      }} 
                    />
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <span dangerouslySetInnerHTML={{ __html: highlighted || code }} />
          )}
        </code>
      </pre>
    </div>
  );
}
