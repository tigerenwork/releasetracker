'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Loader2, Play, Copy, CheckCircle, XCircle } from 'lucide-react';
import { agentBridge, type ExecutionResult } from '@/lib/services/agent-bridge';

interface ScriptStepExecutorProps {
  stepId: number;
  customerId: number;
  releaseId: number;
  content: string;
  interpreter: 'bash' | 'python' | 'node';
  config: {
    namespace: string;
    podSelector: string;
    containerName?: string;
    workingDir?: string;
  };
  onExecutionComplete?: (result: ExecutionResult) => void;
}

export function ScriptStepExecutor({
  stepId,
  customerId,
  releaseId,
  content,
  interpreter,
  config,
  onExecutionComplete,
}: ScriptStepExecutorProps) {
  const [isExecuting, setIsExecuting] = useState(false);
  const [result, setResult] = useState<ExecutionResult | null>(null);
  const [showPreview, setShowPreview] = useState(false);

  const handleExecute = async () => {
    if (!agentBridge) {
      alert('Extension not available. Please install the browser extension.');
      return;
    }

    setIsExecuting(true);
    setResult(null);

    try {
      const executionResult = await agentBridge.executeScript(
        {
          customerId,
          namespace: config.namespace,
          podSelector: config.podSelector,
          containerName: config.containerName,
          stepId,
          releaseId,
        },
        {
          interpreter,
          content,
          workingDir: config.workingDir,
        }
      );

      setResult(executionResult);
      onExecutionComplete?.(executionResult);

      if (executionResult.success) {
        console.log('Script executed successfully:', executionResult.duration, 'ms');
      } else {
        console.error('Script execution failed:', executionResult.error?.message);
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      alert(`Execution failed: ${errorMessage}`);
    } finally {
      setIsExecuting(false);
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    console.log('Copied to clipboard');
  };

  const getInterpreterLabel = (i: string) => {
    switch (i) {
      case 'bash': return 'Bash';
      case 'python': return 'Python';
      case 'node': return 'Node.js';
      default: return i;
    }
  };

  const getInterpreterColor = (i: string) => {
    switch (i) {
      case 'bash': return 'bg-gray-100';
      case 'python': return 'bg-blue-50 text-blue-800';
      case 'node': return 'bg-green-50 text-green-800';
      default: return 'bg-gray-100';
    }
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center justify-between text-base">
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="bg-amber-50">Script</Badge>
            <Badge className={getInterpreterColor(interpreter)}>
              {getInterpreterLabel(interpreter)}
            </Badge>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => copyToClipboard(content)}
              disabled={isExecuting}
            >
              <Copy className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowPreview(!showPreview)}
              disabled={isExecuting}
            >
              {showPreview ? 'Hide' : 'Preview'}
            </Button>
            <Button
              size="sm"
              onClick={handleExecute}
              disabled={isExecuting}
              className="bg-green-600 hover:bg-green-700"
            >
              {isExecuting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Play className="h-4 w-4" />
              )}
              <span className="ml-2">Execute</span>
            </Button>
          </div>
        </CardTitle>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Script Display */}
        <div className="relative">
          <pre className="rounded-md bg-slate-950 p-4 text-sm text-slate-50 overflow-x-auto">
            <code>{content}</code>
          </pre>
        </div>

        {/* Execution Preview */}
        {showPreview && (
          <div className="rounded-md bg-muted p-3 text-sm">
            <p className="font-medium mb-2">Execution Preview:</p>
            <ul className="space-y-1 text-muted-foreground">
              <li>• Target: {config.namespace}/{config.podSelector}</li>
              <li>• Container: {config.containerName || 'default'}</li>
              <li>• Interpreter: {interpreter}</li>
              {config.workingDir && <li>• Working Dir: {config.workingDir}</li>}
            </ul>
          </div>
        )}

        {/* Result */}
        {result && (
          <div className={`rounded-md p-4 ${result.success ? 'bg-green-50' : 'bg-red-50'}`}>
            <div className="flex items-center gap-2 mb-2">
              {result.success ? (
                <CheckCircle className="h-5 w-5 text-green-600" />
              ) : (
                <XCircle className="h-5 w-5 text-red-600" />
              )}
              <span className={result.success ? 'text-green-800' : 'text-red-800'}>
                {result.success ? 'Success' : 'Failed'}
                {result.exitCode !== undefined && ` (Exit Code: ${result.exitCode})`}
              </span>
              <span className="text-muted-foreground ml-auto">
                {result.duration}ms
              </span>
            </div>

            {result.script?.stdout && (
              <div className="mt-2">
                <p className="text-xs font-medium text-muted-foreground mb-1">Output:</p>
                <pre className="text-xs bg-white/50 p-2 rounded overflow-x-auto max-h-60 font-mono">
                  {result.script.stdout}
                </pre>
              </div>
            )}

            {result.script?.stderr && (
              <div className="mt-2">
                <p className="text-xs font-medium text-red-600 mb-1">Stderr:</p>
                <pre className="text-xs bg-white/50 p-2 rounded overflow-x-auto max-h-40 text-red-700 font-mono">
                  {result.script.stderr}
                </pre>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
