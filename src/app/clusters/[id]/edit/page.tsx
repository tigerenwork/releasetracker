import { notFound } from 'next/navigation';
import { ClusterForm } from '@/components/clusters/cluster-form';
import { getClusterById } from '@/lib/actions/clusters';

interface EditClusterPageProps {
  params: Promise<{
    id: string;
  }>;
}

export default async function EditClusterPage({ params }: EditClusterPageProps) {
  const { id } = await params;
  const cluster = await getClusterById(parseInt(id));

  if (!cluster) {
    notFound();
  }

  return (
    <div className="max-w-2xl">
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-slate-900">Edit Cluster</h1>
        <p className="text-slate-600 mt-1">
          Update cluster information
        </p>
      </div>
      <ClusterForm cluster={cluster} isEdit />
    </div>
  );
}
