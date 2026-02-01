import { ClusterForm } from '@/components/clusters/cluster-form';

export default function NewClusterPage() {
  return (
    <div className="max-w-2xl">
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-slate-900">Create Cluster</h1>
        <p className="text-slate-600 mt-1">
          Add a new Kubernetes cluster to manage your customers
        </p>
      </div>
      <ClusterForm />
    </div>
  );
}
