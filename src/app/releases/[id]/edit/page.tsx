import { notFound } from 'next/navigation';
import { ReleaseForm } from '@/components/releases/release-form';
import { getReleaseById } from '@/lib/actions/releases';

interface EditReleasePageProps {
  params: Promise<{
    id: string;
  }>;
}

export const dynamic = 'force-dynamic';

export default async function EditReleasePage({ params }: EditReleasePageProps) {
  const { id } = await params;
  const release = await getReleaseById(parseInt(id));

  if (!release) {
    notFound();
  }

  return (
    <div className="max-w-2xl">
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-slate-900">Edit Release</h1>
        <p className="text-slate-600 mt-1">
          Update release information
        </p>
      </div>
      <ReleaseForm release={release} isEdit />
    </div>
  );
}
