'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { upsertGrafanaSettings } from '@/lib/actions/grafana';

interface GrafanaSettingsFormProps {
  settings: {
    id: number;
    baseUrl: string;
    datasourceUid: string;
  } | null;
}

export function GrafanaSettingsForm({ settings }: GrafanaSettingsFormProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function handleSubmit(formData: FormData) {
    setIsSubmitting(true);
    setError(null);
    setSaved(false);

    try {
      await upsertGrafanaSettings({
        baseUrl: formData.get('grafanaBaseUrl') as string,
        datasourceUid: formData.get('datasourceUid') as string,
      });
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Grafana</CardTitle>
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
            <Label htmlFor="grafanaBaseUrl">Base URL *</Label>
            <Input
              id="grafanaBaseUrl"
              name="grafanaBaseUrl"
              defaultValue={settings?.baseUrl || ''}
              placeholder="https://grafana.example.com"
              required
            />
            <p className="text-sm text-slate-500">
              Used for Explore deep links from the pods and customers pages. No API token
              needed — links open in your browser session.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="datasourceUid">Loki Datasource UID *</Label>
            <Input
              id="datasourceUid"
              name="datasourceUid"
              defaultValue={settings?.datasourceUid || ''}
              placeholder="e.g., eemm9xzs8cy68c"
              required
            />
            <p className="text-sm text-slate-500">
              From Grafana → Connections → Data sources → Loki (the uid in its URL).
            </p>
          </div>

          <div className="flex gap-4">
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? 'Saving...' : 'Save Settings'}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
