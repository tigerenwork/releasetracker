import { notFound } from 'next/navigation';
import { CustomerForm } from '@/components/customers/customer-form';
import { listClusters } from '@/lib/actions/clusters';

export default async function NewCustomerPage() {
  const clusters = await listClusters();

  if (clusters.length === 0) {
    return (
      <div className="max-w-2xl">
        <div className="mb-6">
          <h1 className="text-3xl font-bold text-slate-900">Create Customer</h1>
        </div>
        <div className="p-6 bg-amber-50 border border-amber-200 rounded-lg">
          <p className="text-amber-800">
            You need to create a cluster first before adding customers.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-2xl">
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-slate-900">Create Customer</h1>
        <p className="text-slate-600 mt-1">
          Add a new customer to a cluster
        </p>
      </div>
      <CustomerForm clusters={clusters} />
    </div>
  );
}
