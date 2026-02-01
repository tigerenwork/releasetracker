import Link from 'next/link';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { CustomerCard } from '@/components/customers/customer-card';
import { listClusters } from '@/lib/actions/clusters';
import { listCustomers } from '@/lib/actions/customers';

export default async function CustomersPage() {
  const [customers, clusters] = await Promise.all([
    listCustomers(),
    listClusters(),
  ]);

  // Group customers by cluster
  const groupedCustomers = customers.reduce((acc, customer) => {
    const clusterId = customer.cluster?.id || 0;
    const clusterName = customer.cluster?.name || 'Unknown Cluster';
    
    if (!acc[clusterId]) {
      acc[clusterId] = {
        clusterName,
        customers: [],
      };
    }
    acc[clusterId].customers.push(customer);
    return acc;
  }, {} as Record<number, { clusterName: string; customers: typeof customers }>);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-slate-900">Customers</h1>
          <p className="text-slate-600 mt-1">
            Manage your customers grouped by cluster
          </p>
        </div>
        <Link href="/customers/new">
          <Button>
            <Plus className="w-4 h-4 mr-2" />
            Add Customer
          </Button>
        </Link>
      </div>

      {customers.length === 0 ? (
        <div className="text-center py-12 bg-white rounded-lg border border-dashed border-slate-300">
          <p className="text-slate-600">No customers yet. Create your first customer to get started.</p>
          <Link href="/customers/new" className="mt-4 inline-block">
            <Button>Create Customer</Button>
          </Link>
        </div>
      ) : (
        <div className="space-y-8">
          {Object.entries(groupedCustomers).map(([clusterId, group]) => (
            <div key={clusterId}>
              <h2 className="text-lg font-semibold text-slate-700 mb-4 flex items-center gap-2">
                <span className="w-2 h-2 bg-blue-500 rounded-full"></span>
                {group.clusterName}
                <span className="text-sm font-normal text-slate-500">
                  ({group.customers.length} customers)
                </span>
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {group.customers.map((customer) => (
                  <CustomerCard key={customer.id} customer={customer} />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
