import { JenkinsSettingsForm } from '@/components/jenkins/jenkins-settings-form';
import { getJenkinsSettings } from '@/lib/actions/jenkins';

// Force dynamic rendering to avoid static generation during build
export const dynamic = 'force-dynamic';

export default async function JenkinsPage() {
  const settings = await getJenkinsSettings();

  return (
    <div className="max-w-2xl">
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-slate-900">Jenkins</h1>
        <p className="text-slate-600 mt-1">
          Configure the Jenkins server used for deployment steps
        </p>
      </div>
      <JenkinsSettingsForm settings={settings} />
    </div>
  );
}
