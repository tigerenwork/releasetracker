import { ReleaseForm } from '@/components/releases/release-form';

export default function NewReleasePage() {
  return (
    <div className="max-w-2xl">
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-slate-900">Create Release</h1>
        <p className="text-slate-600 mt-1">
          Create a new release to manage deployment steps
        </p>
      </div>
      <ReleaseForm />
    </div>
  );
}
