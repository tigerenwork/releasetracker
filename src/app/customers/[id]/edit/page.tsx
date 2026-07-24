import { notFound } from 'next/navigation';
import { CustomerForm } from '@/components/customers/customer-form';
import { getCustomerById } from '@/lib/actions/customers';
import { listClusters } from '@/lib/actions/clusters';
import { getCustomerJenkinsConfig } from '@/lib/actions/jenkins';

interface EditCustomerPageProps {
  params: Promise<{
    id: string;
  }>;
}

export const dynamic = 'force-dynamic';

export default async function EditCustomerPage({ params }: EditCustomerPageProps) {
  const { id } = await params;
  const [customer, clusters, jenkinsConfig] = await Promise.all([
    getCustomerById(parseInt(id)),
    listClusters(),
    getCustomerJenkinsConfig(parseInt(id)),
  ]);

  if (!customer) {
    notFound();
  }

  return (
    <div className="max-w-2xl">
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-slate-900">Edit Customer</h1>
        <p className="text-slate-600 mt-1">
          Update customer information
        </p>
      </div>
      <CustomerForm customer={customer} clusters={clusters} jenkinsConfig={jenkinsConfig} isEdit />
    </div>
  );
}
