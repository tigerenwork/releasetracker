'use client';

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

/**
 * POC Test Page for Agent Bridge
 * 
 * This page tests the communication chain:
 * Web App → Browser Extension → Local Agent
 */

interface ExecutionResult {
  success?: boolean;
  message?: string;
  executionId?: string;
  stdout?: string;
  exitCode?: number;
  duration?: number;
  timestamp?: string;
  yourData?: any;
  error?: string;
}

export default function AgentTestPage() {
  const [extensionAvailable, setExtensionAvailable] = useState<boolean>(false);
  const [agentStatus, setAgentStatus] = useState<{ connected: boolean; version?: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ExecutionResult | null>(null);
  const [command, setCommand] = useState('hello from web');

  // Check extension availability on mount
  useEffect(() => {
    // Check immediately
    checkExtension();
    
    // Listen for the custom event from the extension
    const handleAgentReady = () => {
      console.log('[Agent Test] Extension ready event received');
      checkExtension();
    };
    
    window.addEventListener('rt-agent-ready', handleAgentReady);
    
    // Re-check frequently at first, then slower
    const fastInterval = setInterval(checkExtension, 500);
    const slowInterval = setInterval(checkExtension, 2000);
    
    // Stop fast checks after 5 seconds
    setTimeout(() => clearInterval(fastInterval), 5000);
    
    return () => {
      window.removeEventListener('rt-agent-ready', handleAgentReady);
      clearInterval(fastInterval);
      clearInterval(slowInterval);
    };
  }, []);

  const checkExtension = () => {
    if (typeof window === 'undefined') return;
    
    // Check for API object or meta tag
    const hasApi = !!window.rtAgent;
    const hasMeta = !!document.querySelector('meta[name="rt-extension-ready"]');
    const available = hasApi || hasMeta;
    
    if (available !== extensionAvailable) {
      console.log('[Agent Test] Extension check - API:', hasApi, 'Meta:', hasMeta);
      setExtensionAvailable(available);
      
      // If meta exists but API doesn't, something went wrong
      if (hasMeta && !hasApi) {
        console.warn('[Agent Test] Meta tag found but API missing');
      }
    }
    
    if (available && !agentStatus) {
      checkAgentStatus();
    }
  };

  const checkAgentStatus = async () => {
    try {
      const status = await window.rtAgent!.getStatus();
      setAgentStatus(status);
    } catch (err) {
      setAgentStatus({ connected: false });
    }
  };

  const handlePing = async () => {
    if (!window.rtAgent) {
      alert('Extension not available');
      return;
    }
    
    setLoading(true);
    try {
      const response = await window.rtAgent.ping();
      setResult(response);
    } catch (err) {
      setResult({ error: err instanceof Error ? err.message : 'Unknown error' });
    } finally {
      setLoading(false);
    }
  };

  const handleExecute = async () => {
    if (!window.rtAgent) {
      alert('Extension not available');
      return;
    }
    
    setLoading(true);
    setResult(null);
    
    try {
      const response = await window.rtAgent.execute({
        type: 'bash',
        command: command,
        context: { test: true, timestamp: Date.now() },
        timeout: 10000
      });
      setResult(response);
    } catch (err) {
      setResult({ error: err instanceof Error ? err.message : 'Unknown error' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="container mx-auto max-w-2xl py-10">
      <h1 className="text-3xl font-bold mb-2">Agent Bridge POC</h1>
      <p className="text-muted-foreground mb-8">
        Test the communication chain: Web App → Extension → Local Agent
      </p>

      {/* Status Card */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            Connection Status
            <Badge variant={extensionAvailable ? "default" : "destructive"}>
              {extensionAvailable ? "Extension Detected" : "Extension Not Found"}
            </Badge>
          </CardTitle>
          <CardDescription>
            Check if the browser extension is installed and agent is connected
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between p-3 bg-muted rounded">
            <span className="font-medium">Extension</span>
            <span className={extensionAvailable ? "text-green-600" : "text-red-600"}>
              {extensionAvailable ? "✅ Installed" : "❌ Not installed"}
            </span>
          </div>
          
          {extensionAvailable && (
            <div className="flex items-center justify-between p-3 bg-muted rounded">
              <span className="font-medium">Agent Connection</span>
              <span className={agentStatus?.connected ? "text-green-600" : "text-amber-600"}>
                {agentStatus?.connected 
                  ? `✅ Connected (${agentStatus.version})` 
                  : agentStatus 
                    ? "❌ Disconnected" 
                    : "⏳ Checking..."}
              </span>
            </div>
          )}

          <Button 
            variant="outline" 
            onClick={checkExtension}
            className="w-full"
          >
            Refresh Status
          </Button>
        </CardContent>
      </Card>

      {/* Test Actions */}
      {extensionAvailable && (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle>Test Actions</CardTitle>
            <CardDescription>
              Send test commands through the agent bridge
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Ping Test */}
            <div className="p-4 border rounded">
              <h3 className="font-medium mb-2">1. Simple Ping</h3>
              <p className="text-sm text-muted-foreground mb-3">
                Send a ping command to test basic connectivity
              </p>
              <Button 
                onClick={handlePing}
                disabled={loading}
                variant="secondary"
              >
                {loading ? 'Sending...' : 'Ping Agent'}
              </Button>
            </div>

            {/* Execute Test */}
            <div className="p-4 border rounded">
              <h3 className="font-medium mb-2">2. Execute Command</h3>
              <p className="text-sm text-muted-foreground mb-3">
                Send a custom command through the agent
              </p>
              <input
                type="text"
                value={command}
                onChange={(e) => setCommand(e.target.value)}
                className="w-full p-2 border rounded mb-3 text-sm"
                placeholder="Enter command..."
              />
              <Button 
                onClick={handleExecute}
                disabled={loading}
                className="bg-green-600 hover:bg-green-700"
              >
                {loading ? 'Executing...' : 'Execute via Agent'}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Result */}
      {result && (
        <Card>
          <CardHeader>
            <CardTitle>Result</CardTitle>
          </CardHeader>
          <CardContent>
            <pre className="bg-slate-950 text-slate-50 p-4 rounded text-sm overflow-auto">
              {JSON.stringify(result, null, 2)}
            </pre>
          </CardContent>
        </Card>
      )}

      {/* Setup Instructions */}
      {!extensionAvailable && (
        <Card className="mt-6 border-amber-200 bg-amber-50">
          <CardHeader>
            <CardTitle className="text-amber-800">Setup Required</CardTitle>
          </CardHeader>
          <CardContent className="text-amber-800">
            <ol className="list-decimal ml-5 space-y-2">
              <li>
                <strong>Start the Agent:</strong>
                <code className="block bg-white p-2 rounded mt-1 text-sm">
                  cd agent && node server.js
                </code>
              </li>
              <li>
                <strong>Load Extension:</strong>
                <ul className="list-disc ml-5 mt-1 text-sm">
                  <li>Open Chrome → chrome://extensions/</li>
                  <li>Enable "Developer mode"</li>
                  <li>Click "Load unpacked"</li>
                  <li>Select the <code>extension/</code> folder</li>
                </ul>
              </li>
              <li>
                <strong>Configure:</strong>
                <ul className="list-disc ml-5 mt-1 text-sm">
                  <li>Click extension icon in toolbar</li>
                  <li>Verify token matches: <code>poc-token-123</code></li>
                  <li>Click "Test Connection"</li>
                </ul>
              </li>
              <li>
                <strong>Refresh this page</strong>
              </li>
            </ol>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// Type declarations for window
declare global {
  interface Window {
    rtAgent?: {
      version: string;
      isAvailable(): boolean;
      execute(request: {
        type: string;
        command: string;
        context?: Record<string, any>;
        timeout?: number;
      }): Promise<any>;
      getStatus(): Promise<{ connected: boolean; version?: string }>;
      ping(): Promise<any>;
    };
  }
}
