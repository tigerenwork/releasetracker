'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { CheckCircle, XCircle, Loader2 } from 'lucide-react';
import { upsertJenkinsSettings, testJenkinsConnection } from '@/lib/actions/jenkins';

interface JenkinsSettingsFormProps {
  settings: {
    id: number;
    baseUrl: string;
    username: string;
    hasApiToken: boolean;
  } | null;
}

export function JenkinsSettingsForm({ settings }: JenkinsSettingsFormProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);

  async function handleSubmit(formData: FormData) {
    setIsSubmitting(true);
    setError(null);
    setSaved(false);

    try {
      await upsertJenkinsSettings({
        baseUrl: formData.get('baseUrl') as string,
        username: formData.get('username') as string,
        apiToken: (formData.get('apiToken') as string) || undefined,
      });
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleTest() {
    setIsTesting(true);
    setTestResult(null);

    try {
      const result = await testJenkinsConnection();
      setTestResult({
        ok: true,
        message: `Connected successfully${result.version ? ` (Jenkins ${result.version})` : ''}`,
      });
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
      <CardContent>
        <form action={handleSubmit} className="space-y-6">
          {error && (
            <div className="p-3 bg-red-50 text-red-600 rounded-md text-sm">
              {error}
            </div>
          )}
          {saved && (
            <div className="p-3 bg-green-50 text-green-600 rounded-md text-sm">
              Settings saved.
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="baseUrl">Base URL *</Label>
            <Input
              id="baseUrl"
              name="baseUrl"
              defaultValue={settings?.baseUrl || ''}
              placeholder="https://jenkins.example.com"
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="username">Username</Label>
            <Input
              id="username"
              name="username"
              defaultValue={settings?.username || ''}
              placeholder="deploy-bot"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="apiToken">API Token</Label>
            <Input
              id="apiToken"
              name="apiToken"
              type="password"
              placeholder={settings?.hasApiToken ? '••••••••  (leave blank to keep current token)' : 'Jenkins API token'}
            />
          </div>

          <div className="flex gap-4">
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? 'Saving...' : 'Save Settings'}
            </Button>
            <Button type="button" variant="outline" onClick={handleTest} disabled={isTesting}>
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
          <p className="text-sm text-slate-500">
            Test Connection uses the saved settings. Save first to test new values.
          </p>
        </form>
      </CardContent>
    </Card>
  );
}
