'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { CheckCircle, XCircle, Loader2 } from 'lucide-react';
import {
  getAgentJenkinsSettings,
  testAgentJenkinsConnection,
} from '@/lib/jenkins/browser';
import { agentBridge } from '@/lib/services/agent-bridge';

export function JenkinsSettingsForm() {
  const [loading, setLoading] = useState(true);
  const [isTesting, setIsTesting] = useState(false);
  const [settings, setSettings] = useState<{
    configured: boolean;
    baseUrl: string;
    username: string;
    hasApiToken: boolean;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);

  async function refresh() {
    setLoading(true);
    setError(null);
    try {
      if (!agentBridge?.isAvailable()) {
        throw new Error(
          'Agent extension not detected. Install the Release Tracker extension and start the local agent.'
        );
      }
      const s = await getAgentJenkinsSettings();
      setSettings(s);
    } catch (err) {
      setSettings(null);
      setError(err instanceof Error ? err.message : 'Failed to load Jenkins settings from agent');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  async function handleTest() {
    setIsTesting(true);
    setTestResult(null);
    try {
      const result = await testAgentJenkinsConnection();
      setTestResult({
        ok: true,
        message: `Connected successfully${result.version ? ` (Jenkins ${result.version})` : ''}`,
      });
      await refresh();
    } catch (err) {
      setTestResult({
        ok: false,
        message: err instanceof Error ? err.message : 'Connection failed',
      });
    } finally {
      setIsTesting(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Jenkins Connection</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="p-3 bg-slate-50 text-slate-700 rounded-md text-sm space-y-2">
          <p>
            Jenkins credentials are stored on your <strong>local agent</strong> only
            (so deploys work when Jenkins is behind Netbird). They are never saved on this server.
          </p>
          <ol className="list-decimal list-inside space-y-1 text-slate-600">
            <li>Start the local agent (<code className="text-xs">rt-agent start</code>)</li>
            <li>Open the Release Tracker Chrome extension popup</li>
            <li>Under <strong>Jenkins</strong>, paste Base URL, username, and API token → Save to Agent</li>
            <li>Use Test Jenkins in the popup, or Test Connection below</li>
          </ol>
        </div>

        {loading && (
          <div className="flex items-center gap-2 text-sm text-slate-500">
            <Loader2 className="w-4 h-4 animate-spin" />
            Checking agent Jenkins settings…
          </div>
        )}

        {error && (
          <div className="p-3 bg-red-50 text-red-600 rounded-md text-sm">
            {error}
          </div>
        )}

        {!loading && settings && (
          <div className="space-y-2 text-sm">
            <div className="flex items-center gap-2">
              {settings.configured ? (
                <CheckCircle className="w-4 h-4 text-green-600" />
              ) : (
                <XCircle className="w-4 h-4 text-amber-600" />
              )}
              <span>
                {settings.configured ? 'Configured on local agent' : 'Not configured on local agent'}
              </span>
            </div>
            {settings.baseUrl && (
              <p className="text-slate-600">
                <span className="text-slate-400">Base URL:</span> {settings.baseUrl}
              </p>
            )}
            {settings.username && (
              <p className="text-slate-600">
                <span className="text-slate-400">Username:</span> {settings.username}
              </p>
            )}
          </div>
        )}

        <div className="flex gap-3">
          <Button type="button" variant="outline" onClick={refresh} disabled={loading}>
            Refresh
          </Button>
          <Button type="button" variant="outline" onClick={handleTest} disabled={isTesting || loading}>
            {isTesting && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
            Test Connection
          </Button>
        </div>

        {testResult && (
          <div className={`flex items-center gap-2 p-3 rounded-md text-sm ${
            testResult.ok ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'
          }`}>
            {testResult.ok ? (
              <CheckCircle className="w-4 h-4" />
            ) : (
              <XCircle className="w-4 h-4" />
            )}
            {testResult.message}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
