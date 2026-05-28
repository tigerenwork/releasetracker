'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Loader2, Play, Copy, CheckCircle, XCircle } from 'lucide-react';
import { agentBridge, type ExecutionResult } from '@/lib/services/agent-bridge';

interface RESTStepExecutorProps {
  stepId: number;
  customerId: number;
  releaseId: number;
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  url: string;
  payload?: Record<string, any>;
  headers?: Record<string, string>;
  config: {
    namespace: string;
    podSelector: string;
    containerName?: string;
    baseUrl?: string;
  };
  onExecutionComplete?: (result: ExecutionResult) => void;
}

export function RESTStepExecutor({
  stepId,
  customerId,
  releaseId,
  method,
  url,
  payload,
  headers,
  config,
  onExecutionComplete,
}: RESTStepExecutorProps) {
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
      const executionResult = await agentBridge.executeREST(
        {
          customerId,
          namespace: config.namespace,
          podSelector: config.podSelector,
          containerName: config.containerName,
          stepId,
          releaseId,
        },
        {
          method,
          url,
          baseUrl: config.baseUrl,
          payload,
          headers,
          expectJson: true,
        }
      );

      setResult(executionResult);
      onExecutionComplete?.(executionResult);

      if (executionResult.success) {
        console.log('API call successful:', executionResult.rest?.statusCode);
      } else {
        console.error('API call failed:', executionResult.error?.message);
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

  const getMethodColor = (m: string) => {
    switch (m) {
      case 'GET': return 'bg-green-100 text-green-800';
      case 'POST': return 'bg-blue-100 text-blue-800';
      case 'PUT': return 'bg-yellow-100 text-yellow-800';
      case 'PATCH': return 'bg-orange-100 text-orange-800';
      case 'DELETE': return 'bg-red-100 text-red-800';
      default: return 'bg-gray-100';
    }
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center justify-between text-base">
          <div className="flex items-center gap-2">
            <Badge className={getMethodColor(method)}>{method}</Badge>
            <Badge variant="outline" className="bg-purple-50">REST</Badge>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => copyToClipboard(url)}
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
        {/* URL Display */}
        <div className="font-mono text-sm bg-slate-100 p-3 rounded">
          {config.baseUrl}{url}
        </div>

        {/* Payload Display */}
        {payload && (
          <div>
            <p className="text-xs font-medium text-muted-foreground mb-1">Payload:</p>
            <pre className="text-xs bg-slate-950 text-slate-50 p-3 rounded overflow-x-auto">
              {JSON.stringify(payload, null, 2)}
            </pre>
          </div>
        )}

        {/* Execution Preview */}
        {showPreview && (
          <div className="rounded-md bg-muted p-3 text-sm">
            <p className="font-medium mb-2">Execution Preview:</p>
            <ul className="space-y-1 text-muted-foreground">
              <li>• Target: {config.namespace}/{config.podSelector}</li>
              <li>• Container: {config.containerName || 'default'}</li>
              <li>• Method: {method}</li>
              <li>• Full URL: {config.baseUrl}{url}</li>
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
                HTTP {result.rest?.statusCode}
              </span>
              <span className="text-muted-foreground ml-auto">
                {result.duration}ms
              </span>
            </div>

            {result.rest?.body && (
              <div className="mt-2">
                <p className="text-xs font-medium text-muted-foreground mb-1">Response:</p>
                <pre className="text-xs bg-white/50 p-2 rounded overflow-x-auto max-h-40">
                  {result.rest.json
                    ? JSON.stringify(result.rest.json, null, 2)
                    : result.rest.body}
                </pre>
              </div>
            )}

            {result.error && (
              <div className="mt-2 text-sm text-red-700">
                {result.error.message}
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
