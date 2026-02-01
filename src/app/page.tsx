import Link from 'next/link';
import { Package, Server, Users, CheckCircle, Clock, SkipForward } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { listClusters } from '@/lib/actions/clusters';
import { listCustomers } from '@/lib/actions/customers';
import { getActiveReleases, getReleaseStats } from '@/lib/actions/releases';
import { db } from '@/lib/db';
import { customers } from '@/lib/db/schema';
import { eq, count } from 'drizzle-orm';

export default async function DashboardPage() {
  const [clusters, customersList, activeReleases, stats] = await Promise.all([
    listClusters(),
    listCustomers(),
    getActiveReleases(),
    getReleaseStats(),
  ]);

  // Get customer counts per cluster
  const clustersWithCount = await Promise.all(
    clusters.map(async (cluster) => {
      const result = await db
        .select({ value: count() })
        .from(customers)
        .where(eq(customers.clusterId, cluster.id));
      return {
        ...cluster,
        customerCount: result[0]?.value || 0,
      };
    })
  );

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold text-slate-900">Dashboard</h1>
        <p className="text-slate-600 mt-1">
          Overview of your release orchestration system
        </p>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-slate-500">
              Active Releases
            </CardTitle>
            <Package className="w-4 h-4 text-blue-600" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{stats.activeReleases}</div>
            <p className="text-xs text-slate-500 mt-1">
              of {stats.totalReleases} total
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-slate-500">
              Pending Steps
            </CardTitle>
            <Clock className="w-4 h-4 text-amber-600" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{stats.pendingSteps}</div>
            <p className="text-xs text-slate-500 mt-1">
              awaiting completion
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-slate-500">
              Completed Steps
            </CardTitle>
            <CheckCircle className="w-4 h-4 text-green-600" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{stats.doneSteps}</div>
            <p className="text-xs text-slate-500 mt-1">
              successfully done
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-slate-500">
              Total Customers
            </CardTitle>
            <Users className="w-4 h-4 text-emerald-600" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{customersList.length}</div>
            <p className="text-xs text-slate-500 mt-1">
              across {clusters.length} clusters
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Active Releases */}
        <Card className="lg:col-span-2">
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>Active Releases</CardTitle>
            <Link href="/releases">
              <Button variant="outline" size="sm">View All</Button>
            </Link>
          </CardHeader>
          <CardContent>
            {activeReleases.length === 0 ? (
              <div className="text-center py-8 text-slate-500">
                <p>No active releases.</p>
                <Link href="/releases/new">
                  <Button className="mt-4" size="sm">Create Release</Button>
                </Link>
              </div>
            ) : (
              <div className="space-y-3">
                {activeReleases.slice(0, 5).map((release) => (
                  <Link 
                    key={release.id} 
                    href={`/releases/${release.id}`}
                    className="flex items-center justify-between p-4 bg-slate-50 rounded-lg hover:bg-slate-100 transition-colors"
                  >
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="font-medium text-slate-900">{release.name}</h3>
                        <Badge variant={release.type === 'hotfix' ? 'destructive' : 'default'} className="text-xs">
                          {release.type}
                        </Badge>
                      </div>
                      {release.versionNumber && (
                        <p className="text-sm text-slate-500">{release.versionNumber}</p>
                      )}
                    </div>
                    <Button variant="outline" size="sm">View</Button>
                  </Link>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Clusters Overview */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>Clusters</CardTitle>
            <Link href="/clusters">
              <Button variant="outline" size="sm">Manage</Button>
            </Link>
          </CardHeader>
          <CardContent>
            {clustersWithCount.length === 0 ? (
              <div className="text-center py-8 text-slate-500">
                <p>No clusters configured.</p>
                <Link href="/clusters/new">
                  <Button className="mt-4" size="sm">Add Cluster</Button>
                </Link>
              </div>
            ) : (
              <div className="space-y-3">
                {clustersWithCount.map((cluster) => (
                  <Link 
                    key={cluster.id} 
                    href={`/clusters/${cluster.id}`}
                    className="flex items-center justify-between p-3 bg-slate-50 rounded-lg hover:bg-slate-100 transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      <Server className="w-4 h-4 text-slate-400" />
                      <span className="font-medium text-slate-900">{cluster.name}</span>
                    </div>
                    <Badge variant="secondary">{cluster.customerCount}</Badge>
                  </Link>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Quick Actions */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Link href="/releases/new">
          <Card className="hover:shadow-md transition-shadow cursor-pointer h-full">
            <CardContent className="flex items-center gap-4 py-6">
              <div className="w-12 h-12 bg-blue-100 rounded-lg flex items-center justify-center">
                <Package className="w-6 h-6 text-blue-600" />
              </div>
              <div>
                <h3 className="font-semibold text-slate-900">Create Release</h3>
                <p className="text-sm text-slate-500">Start a new deployment cycle</p>
              </div>
            </CardContent>
          </Card>
        </Link>

        <Link href="/clusters/new">
          <Card className="hover:shadow-md transition-shadow cursor-pointer h-full">
            <CardContent className="flex items-center gap-4 py-6">
              <div className="w-12 h-12 bg-purple-100 rounded-lg flex items-center justify-center">
                <Server className="w-6 h-6 text-purple-600" />
              </div>
              <div>
                <h3 className="font-semibold text-slate-900">Add Cluster</h3>
                <p className="text-sm text-slate-500">Register a new K8s cluster</p>
              </div>
            </CardContent>
          </Card>
        </Link>

        <Link href="/customers/new">
          <Card className="hover:shadow-md transition-shadow cursor-pointer h-full">
            <CardContent className="flex items-center gap-4 py-6">
              <div className="w-12 h-12 bg-emerald-100 rounded-lg flex items-center justify-center">
                <Users className="w-6 h-6 text-emerald-600" />
              </div>
              <div>
                <h3 className="font-semibold text-slate-900">Add Customer</h3>
                <p className="text-sm text-slate-500">Onboard a new customer</p>
              </div>
            </CardContent>
          </Card>
        </Link>
      </div>
    </div>
  );
}
