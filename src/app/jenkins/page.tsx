import { JenkinsSettingsForm } from '@/components/jenkins/jenkins-settings-form';
import { GrafanaSettingsForm } from '@/components/jenkins/grafana-settings-form';
import { getGrafanaSettings } from '@/lib/actions/grafana';

// Force dynamic rendering to avoid static generation during build
export const dynamic = 'force-dynamic';

export default async function JenkinsPage() {
  const grafanaSettings = await getGrafanaSettings();

  return (
    <div className="max-w-2xl space-y-8">
      <div>
        <div className="mb-6">
          <h1 className="text-3xl font-bold text-slate-900">Jenkins</h1>
          <p className="text-slate-600 mt-1">
            Configure Jenkins via the local agent (extension popup) for deployment steps
          </p>
        </div>
        <JenkinsSettingsForm />
      </div>

      <div>
        <div className="mb-6">
          <h1 className="text-3xl font-bold text-slate-900">Grafana</h1>
          <p className="text-slate-600 mt-1">
            Configure Grafana Explore deep links for log navigation
          </p>
        </div>
        <GrafanaSettingsForm settings={grafanaSettings} />
      </div>
    </div>
  );
}
