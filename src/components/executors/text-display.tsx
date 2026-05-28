'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { CheckSquare, Square, Copy } from 'lucide-react';

interface TextStepDisplayProps {
  stepId: number;
  content: string;
  checklist?: string[];
  onMarkDone?: (stepId: number, notes?: string) => void;
  onSkip?: (stepId: number, reason: string) => void;
}

export function TextStepDisplay({
  stepId,
  content,
  checklist,
  onMarkDone,
  onSkip,
}: TextStepDisplayProps) {
  const [checkedItems, setCheckedItems] = useState<boolean[]>(
    new Array(checklist?.length || 0).fill(false)
  );
  const [notes, setNotes] = useState('');

  const toggleItem = (index: number) => {
    const newChecked = [...checkedItems];
    newChecked[index] = !newChecked[index];
    setCheckedItems(newChecked);
  };

  const allChecked = checklist ? checkedItems.every(Boolean) : true;

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    console.log('Copied to clipboard');
  };

  const handleMarkDone = () => {
    if (!allChecked) {
      alert('Please complete all checklist items before marking as done');
      return;
    }
    onMarkDone?.(stepId, notes);
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center justify-between text-base">
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="bg-gray-100">Manual</Badge>
            <span className="text-sm text-muted-foreground">Text Step</span>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => copyToClipboard(content)}
          >
            <Copy className="h-4 w-4" />
          </Button>
        </CardTitle>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Content Display */}
        <div className="prose prose-sm max-w-none">
          <div className="whitespace-pre-wrap">{content}</div>
        </div>

        {/* Checklist */}
        {checklist && checklist.length > 0 && (
          <div className="rounded-md bg-muted p-4">
            <p className="font-medium mb-3">Checklist:</p>
            <ul className="space-y-2">
              {checklist.map((item, index) => (
                <li
                  key={index}
                  className="flex items-start gap-2 cursor-pointer"
                  onClick={() => toggleItem(index)}
                >
                  <button className="mt-0.5">
                    {checkedItems[index] ? (
                      <CheckSquare className="h-5 w-5 text-green-600" />
                    ) : (
                      <Square className="h-5 w-5 text-gray-400" />
                    )}
                  </button>
                  <span className={checkedItems[index] ? 'line-through text-muted-foreground' : ''}>
                    {item}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Notes Input */}
        <div>
          <p className="text-sm font-medium mb-2">Notes (optional):</p>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Add any notes about this step..."
            className="w-full p-2 border rounded-md text-sm min-h-[80px]"
          />
        </div>

        {/* Actions */}
        <div className="flex gap-2 pt-2">
          <Button
            onClick={handleMarkDone}
            disabled={!allChecked}
            className="bg-green-600 hover:bg-green-700"
          >
            Mark as Done
          </Button>
          {onSkip && (
            <Button
              variant="outline"
              onClick={() => onSkip(stepId, notes)}
            >
              Skip
            </Button>
          )}
        </div>

        {!allChecked && checklist && (
          <p className="text-xs text-amber-600">
            Complete all checklist items before marking as done
          </p>
        )}
      </CardContent>
    </Card>
  );
}
