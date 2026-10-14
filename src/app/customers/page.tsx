import Link from 'next/link';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { CustomerCard } from '@/components/customers/customer-card';
import { CustomerListItem } from '@/components/customers/customer-list-item';
import { ViewToggle } from '@/components/customers/view-toggle';
import { CollectionList, type CollectionEntry } from '@/components/collections/collection-list';
import { listCustomers } from '@/lib/actions/customers';
import { listCollections } from '@/lib/actions/customer-collections';

// Force dynamic rendering to avoid static generation during build
export const dynamic = 'force-dynamic';

interface CustomersPageProps {
  searchParams: Promise<{ view?: string }>;
}

export default async function CustomersPage({ searchParams }: CustomersPageProps) {
  const { view } = await searchParams;
  // List is the default view; grid is opt-in via ?view=grid
  const currentView: 'grid' | 'list' = view === 'grid' ? 'grid' : 'list';

  const [customers, collections] = await Promise.all([
    listCustomers(),
    listCollections(),
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

  const pickerCustomers = customers.map((c) => ({
    id: c.id,
    name: c.name,
    namespace: c.namespace,
    cluster: {
      id: c.cluster?.id ?? 0,
      name: c.cluster?.name ?? 'Unknown Cluster',
    },
  }));

  const collectionEntries: CollectionEntry[] = collections.map((collection) => {
    const activeMembers = collection.members.filter((m) => m.customer?.isActive);
    const clusterSpread: Record<string, number> = {};
    for (const member of activeMembers) {
      const clusterName = member.customer?.cluster?.name ?? 'Unknown';
      clusterSpread[clusterName] = (clusterSpread[clusterName] ?? 0) + 1;
    }
    return {
      id: collection.id,
      name: collection.name,
      description: collection.description,
      customerIds: activeMembers.map((m) => m.customerId),
      clusterSpread,
    };
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-slate-900">Customers</h1>
        <p className="text-slate-600 mt-1">
          Manage your customers and reusable customer collections
        </p>
      </div>

      <Tabs defaultValue="customers">
        <TabsList>
          <TabsTrigger value="customers">Customers</TabsTrigger>
          <TabsTrigger value="collections">Collections</TabsTrigger>
        </TabsList>

        <TabsContent value="customers" className="space-y-6 pt-4">
          <div className="flex items-center justify-end gap-3">
            <ViewToggle currentView={currentView} />
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

                  {currentView === 'grid' ? (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                      {group.customers.map((customer) => (
                        <CustomerCard key={customer.id} customer={customer} />
                      ))}
                    </div>
                  ) : (
                    <div className="rounded-lg border overflow-hidden">
                      <div className="flex items-center gap-4 px-4 py-2 bg-slate-50 border-b text-xs font-medium text-slate-500 uppercase tracking-wide">
                        <span className="flex-1">Name</span>
                        <span className="w-40 hidden sm:block">Namespace</span>
                        <span className="w-[140px] ml-auto text-right">Actions</span>
                      </div>
                      {group.customers.map((customer) => (
                        <CustomerListItem key={customer.id} customer={customer} />
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="collections" className="pt-4">
          <CollectionList collections={collectionEntries} customers={pickerCustomers} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
