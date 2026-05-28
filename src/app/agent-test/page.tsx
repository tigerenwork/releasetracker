'use client';

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  SQLStepExecutor,
  RESTStepExecutor,
  ScriptStepExecutor,
  TextStepDisplay,
} from '@/components/executors';
import { agentBridge, type AgentStatus } from '@/lib/services/agent-bridge';

/**
 * POC Test Page for Agent Bridge
 * 
 * This page tests the communication chain and demonstrates
 * all execution types: SQL, REST, Script, and Text
 */

export default function AgentTestPage() {
  const [extensionAvailable, setExtensionAvailable] = useState<boolean>(false);
  const [agentStatus, setAgentStatus] = useState<AgentStatus | null>(null);

  // Check extension availability
  useEffect(() => {
    const check = () => {
      const available = agentBridge?.isAvailable() || false;
      setExtensionAvailable(available);
      
      if (available) {
        agentBridge?.checkStatus().then(setAgentStatus);
      }
    };

    check();
    const interval = setInterval(check, 2000);
    return () => clearInterval(interval);
  }, []);

  // Sample configurations (these would normally come from customer settings)
  const sqlConfig = {
    namespace: 'default',
    podSelector: 'app=db-client',
    sqlClient: 'psql' as const,
    connectionEnvVar: 'DATABASE_URL',
  };

  const restConfig = {
    namespace: 'default',
    podSelector: 'app=api-client',
    baseUrl: 'http://localhost:8080',
  };

  const scriptConfig = {
    namespace: 'default',
    podSelector: 'app=executor',
  };

  return (
    <div className="container mx-auto max-w-4xl py-10">
      <h1 className="text-3xl font-bold mb-2">Agent Execution System</h1>
      <p className="text-muted-foreground mb-8">
        Test SQL, REST, Script, and Text step execution via the agent bridge
      </p>

      {/* Status Card */}
      <Card className="mb-8">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            Connection Status
            <Badge variant={extensionAvailable ? "default" : "destructive"}>
              {extensionAvailable ? "Extension Detected" : "Extension Not Found"}
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <div className={`w-2 h-2 rounded-full ${extensionAvailable ? 'bg-green-500' : 'bg-red-500'}`} />
              <span>Extension: {extensionAvailable ? 'Installed' : 'Not installed'}</span>
            </div>
            {agentStatus && (
              <div className="flex items-center gap-2">
                <div className={`w-2 h-2 rounded-full ${agentStatus.connected ? 'bg-green-500' : 'bg-red-500'}`} />
                <span>
                  Agent: {agentStatus.connected 
                    ? `Connected (${agentStatus.version})` 
                    : 'Disconnected'}
                </span>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Execution Types */}
      <Tabs defaultValue="sql" className="space-y-6">
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="sql">SQL</TabsTrigger>
          <TabsTrigger value="rest">REST</TabsTrigger>
          <TabsTrigger value="script">Script</TabsTrigger>
          <TabsTrigger value="text">Text</TabsTrigger>
        </TabsList>

        <TabsContent value="sql" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>SQL Execution Test</CardTitle>
              <CardDescription>
                Execute SQL queries via kubectl exec into database client pods
              </CardDescription>
            </CardHeader>
            <CardContent>
              <SQLStepExecutor
                stepId={1}
                customerId={1}
                releaseId={1}
                query="SELECT version();"
                config={sqlConfig}
                onExecutionComplete={(result) => {
                  console.log('SQL execution completed:', result);
                }}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Another SQL Example</CardTitle>
            </CardHeader>
            <CardContent>
              <SQLStepExecutor
                stepId={2}
                customerId={1}
                releaseId={1}
                query="\\dt"
                config={{ ...sqlConfig, sqlClient: 'psql' }}
              />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="rest" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>REST API Execution Test</CardTitle>
              <CardDescription>
                Execute REST API calls via curl in pods
              </CardDescription>
            </CardHeader>
            <CardContent>
              <RESTStepExecutor
                stepId={3}
                customerId={1}
                releaseId={1}
                method="GET"
                url="/health"
                config={restConfig}
                onExecutionComplete={(result) => {
                  console.log('REST execution completed:', result);
                }}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>POST Request Example</CardTitle>
            </CardHeader>
            <CardContent>
              <RESTStepExecutor
                stepId={4}
                customerId={1}
                releaseId={1}
                method="POST"
                url="/api/v1/migrate"
                payload={{ version: '1.2.3', dryRun: false }}
                headers={{ 'X-Api-Key': 'test-key' }}
                config={restConfig}
              />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="script" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Script Execution Test</CardTitle>
              <CardDescription>
                Execute custom scripts in pods
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ScriptStepExecutor
                stepId={5}
                customerId={1}
                releaseId={1}
                content={`#!/bin/bash
echo "Starting migration..."
echo "Step 1: Check environment"
env | grep -E '(DATABASE|API)' || echo "No env vars set"
echo "Step 2: Run commands"
echo "Done!"`}
                interpreter="bash"
                config={scriptConfig}
                onExecutionComplete={(result) => {
                  console.log('Script execution completed:', result);
                }}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Python Script Example</CardTitle>
            </CardHeader>
            <CardContent>
              <ScriptStepExecutor
                stepId={6}
                customerId={1}
                releaseId={1}
                content={`import json
import sys

print("Python script execution")
print("Arguments:", sys.argv)
print("Environment check complete")

# Output some JSON
result = {"status": "success", "items_processed": 42}
print(json.dumps(result, indent=2))`}
                interpreter="python"
                config={scriptConfig}
              />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="text" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Manual Step Display</CardTitle>
              <CardDescription>
                Text steps for manual verification and documentation
              </CardDescription>
            </CardHeader>
            <CardContent>
              <TextStepDisplay
                stepId={7}
                content={`Please verify the following before proceeding:

1. Check that all database migrations have been applied
2. Verify that the application is responding to health checks
3. Confirm that monitoring alerts are green
4. Review the deployment notes for any special instructions

If all checks pass, mark this step as done.`}
                checklist={[
                  'Database migrations verified',
                  'Health checks passing',
                  'Monitoring alerts green',
                  'Deployment notes reviewed',
                ]}
                onMarkDone={(stepId, notes) => {
                  console.log('Step marked as done:', stepId, notes);
                  alert(`Step ${stepId} marked as done! Notes: ${notes}`);
                }}
                onSkip={(stepId, reason) => {
                  console.log('Step skipped:', stepId, reason);
                }}
              />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Setup Instructions */}
      {!extensionAvailable && (
        <Card className="mt-8 border-amber-200 bg-amber-50">
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
                  <li>Enable &quot;Developer mode&quot;</li>
                  <li>Click &quot;Load unpacked&quot;</li>
                  <li>Select the <code>extension/</code> folder</li>
                </ul>
              </li>
              <li>
                <strong>Configure:</strong>
                <ul className="list-disc ml-5 mt-1 text-sm">
                  <li>Click extension icon in toolbar</li>
                  <li>Verify token matches: <code>poc-token-123</code></li>
                  <li>Click &quot;Test Connection&quot;</li>
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
