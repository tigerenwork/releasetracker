import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { ArrowLeft, Edit, Play, Archive, Plus, CheckCircle, Circle, SkipForward, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Separator } from '@/components/ui/separator';
import { getReleaseById, activateRelease, archiveRelease } from '@/lib/actions/releases';
import { getReleaseStepsGroupedByCluster, getStepStats } from '@/lib/actions/customer-steps';
import { listCustomers } from '@/lib/actions/customers';

interface ReleaseDetailPageProps {
  params: Promise<{
    id: string;
  }>;
}

const typeColors: Record<string, string> = {
  onboarding: 'bg-purple-100 text-purple-800',
  release: 'bg-blue-100 text-blue-800',
  hotfix: 'bg-red-100 text-red-800',
};

const statusColors: Record<string, string> = {
  draft: 'bg-slate-100 text-slate-800',
  active: 'bg-green-100 text-green-800',
  archived: 'bg-gray-100 text-gray-800',
};

function getTypeColor(type: string) {
  return typeColors[type] || 'bg-slate-100 text-slate-800';
}

function getStatusColor(status: string) {
  return statusColors[status] || 'bg-slate-100 text-slate-800';
}

export default async function ReleaseDetailPage({ params }: ReleaseDetailPageProps) {
  const { id } = await params;
  const releaseId = parseInt(id);
  const release = await getReleaseById(releaseId);

  if (!release) {
    notFound();
  }

  // Get steps grouped by cluster
  const stepsByCluster = release.status === 'active' 
    ? await getReleaseStepsGroupedByCluster(releaseId)
    : {};

  const stats = release.status === 'active' 
    ? await getStepStats(releaseId)
    : { total: 0, done: 0, skipped: 0, pending: 0, reverted: 0, percentage: 0 };

  const customers = await listCustomers();

  async function handleActivate() {
    'use server';
    await activateRelease(releaseId);
    redirect(`/releases/${releaseId}`);
  }

  async function handleArchive() {
    'use server';
    await archiveRelease(releaseId);
    redirect(`/releases/${releaseId}`);
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-4">
          <Link href="/releases">
            <Button variant="outline" size="icon">
              <ArrowLeft className="w-4 h-4" />
            </Button>
          </Link>
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-3xl font-bold text-slate-900">{release.name}</h1>
              <Badge className={getTypeColor(release.type || '')}>{release.type}</Badge>
              <Badge className={getStatusColor(release.status || '')}>{release.status}</Badge>
            </div>
            {release.versionNumber && (
              <p className="text-slate-600 mt-1">Version: {release.versionNumber}</p>
            )}
          </div>
        </div>
        <div className="flex gap-2">
          <Link href={`/releases/${releaseId}/edit`}>
            <Button variant="outline" size="sm">
              <Edit className="w-4 h-4 mr-2" />
              Edit
            </Button>
          </Link>
          {release.status === 'draft' && (
            <form action={handleActivate}>
              <Button size="sm" type="submit">
                <Play className="w-4 h-4 mr-2" />
                Activate
              </Button>
            </form>
          )}
          {release.status === 'active' && (
            <form action={handleArchive}>
              <Button variant="outline" size="sm" type="submit">
                <Archive className="w-4 h-4 mr-2" />
                Archive
              </Button>
            </form>
          )}
        </div>
      </div>

      {/* Release Info */}
      <Card>
        <CardContent className="pt-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div>
              <label className="text-sm font-medium text-slate-500">Release Date</label>
              <p className="text-slate-900">
                {release.releaseDate 
                  ? new Date(release.releaseDate).toLocaleDateString() 
                  : 'Not set'}
              </p>
            </div>
            <div>
              <label className="text-sm font-medium text-slate-500">Total Customers</label>
              <p className="text-slate-900">{customers.length}</p>
            </div>
            {release.status === 'active' && (
              <div>
                <label className="text-sm font-medium text-slate-500">Progress</label>
                <div className="flex items-center gap-2">
                  <div className="flex-1 bg-slate-200 rounded-full h-2">
                    <div 
                      className="bg-green-500 h-2 rounded-full transition-all"
                      style={{ width: `${stats.percentage}%` }}
                    />
                  </div>
                  <span className="text-sm font-medium">{stats.percentage}%</span>
                </div>
              </div>
            )}
          </div>
          {release.description && (
            <>
              <Separator className="my-4" />
              <div>
                <label className="text-sm font-medium text-slate-500">Description</label>
                <p className="text-slate-900 mt-1 whitespace-pre-wrap">{release.description}</p>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Steps Management (for draft) */}
      {release.status === 'draft' && (
        <Card>
          <CardHeader>
            <CardTitle>Template Steps</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <h3 className="font-medium mb-3">Deploy Steps ({release.templates.filter(t => t.category === 'deploy').length})</h3>
                <Link href={`/releases/${releaseId}/steps`}>
                  <Button variant="outline" size="sm">
                    <Plus className="w-4 h-4 mr-2" />
                    Manage Deploy Steps
                  </Button>
                </Link>
              </div>
              <div>
                <h3 className="font-medium mb-3">Verify Steps ({release.templates.filter(t => t.category === 'verify').length})</h3>
                <Link href={`/releases/${releaseId}/steps`}>
                  <Button variant="outline" size="sm">
                    <Plus className="w-4 h-4 mr-2" />
                    Manage Verify Steps
                  </Button>
                </Link>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Matrix View (for active) */}
      {release.status === 'active' && (
        <Tabs defaultValue="deploy">
          <TabsList>
            <TabsTrigger value="deploy">
              Deploy ({stats.done + stats.skipped}/{stats.total})
            </TabsTrigger>
            <TabsTrigger value="verify">
              Verify 
            </TabsTrigger>
          </TabsList>

          <TabsContent value="deploy" className="mt-4">
            <MatrixView 
              stepsByCluster={stepsByCluster} 
              category="deploy"
              releaseId={releaseId}
            />
          </TabsContent>

          <TabsContent value="verify" className="mt-4">
            <MatrixView 
              stepsByCluster={stepsByCluster} 
              category="verify"
              releaseId={releaseId}
            />
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}

interface MatrixViewProps {
  stepsByCluster: any;
  category: 'deploy' | 'verify';
  releaseId: number;
}

function MatrixView({ stepsByCluster, category, releaseId }: MatrixViewProps) {
  const clusters = Object.values(stepsByCluster);

  if (clusters.length === 0) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-slate-500">
          No customers found. Add customers to see the matrix view.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {clusters.map((clusterData: any) => {
        const customers = Object.values(clusterData.customers);
        
        // Get all unique steps for this category
        const allSteps = new Map();
        customers.forEach((customer: any) => {
          customer.steps
            .filter((s: any) => s.category === category)
            .forEach((step: any) => {
              if (!allSteps.has(step.name)) {
                allSteps.set(step.name, step);
              }
            });
        });
        const steps = Array.from(allSteps.values()).sort((a: any, b: any) => a.orderIndex - b.orderIndex);

        if (steps.length === 0) return null;

        return (
          <Card key={clusterData.cluster?.id || 'unknown'}>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <span className="w-3 h-3 bg-blue-500 rounded-full"></span>
                {clusterData.cluster?.name || 'Unknown Cluster'}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b">
                      <th className="text-left py-2 px-3 font-medium text-slate-500 w-48">Step</th>
                      {customers.map((customer: any) => (
                        <th key={customer.customer.id} className="text-center py-2 px-3 font-medium text-slate-500 min-w-[120px]">
                          <div>{customer.customer.name}</div>
                          <div className="text-xs text-slate-400 font-normal">{customer.customer.namespace}</div>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {steps.map((step: any, stepIndex: number) => (
                      <tr key={step.id} className="border-b hover:bg-slate-50">
                        <td className="py-3 px-3">
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-slate-400">{stepIndex + 1}.</span>
                            <div>
                              <p className="font-medium text-sm">{step.name}</p>
                              {step.isOverridden && (
                                <Badge variant="outline" className="text-xs">custom</Badge>
                              )}
                            </div>
                          </div>
                        </td>
                        {customers.map((customer: any) => {
                          const customerStep = customer.steps.find(
                            (s: any) => s.name === step.name && s.category === category
                          );
                          
                          if (!customerStep) return <td key={customer.customer.id} className="py-2 px-3"></td>;

                          return (
                            <td key={customer.customer.id} className="py-2 px-3 text-center">
                              <StepStatusCell step={customerStep} releaseId={releaseId} />
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

function StepStatusCell({ step, releaseId }: { step: any; releaseId: number }) {
  const statusIcons = {
    pending: <Circle className="w-5 h-5 text-slate-300" />,
    done: <CheckCircle className="w-5 h-5 text-green-500" />,
    skipped: <SkipForward className="w-5 h-5 text-amber-500" />,
    reverted: <RotateCcw className="w-5 h-5 text-red-500" />,
  };

  async function markDone() {
    'use server';
    const { markStepDone } = await import('@/lib/actions/customer-steps');
    await markStepDone(step.id);
  }

  async function skipStep(formData: FormData) {
    'use server';
    const { skipStep } = await import('@/lib/actions/customer-steps');
    await skipStep(step.id, formData.get('reason') as string);
  }

  return (
    <div className="flex flex-col items-center gap-1">
      <form action={markDone}>
        <button type="submit" className="hover:scale-110 transition-transform">
          {statusIcons[step.status as keyof typeof statusIcons]}
        </button>
      </form>
      {step.status === 'pending' && (
        <form action={skipStep} className="flex gap-1">
          <input name="reason" type="hidden" value="Skipped by user" />
          <button type="submit" className="text-xs text-slate-400 hover:text-amber-600">
            skip
          </button>
        </form>
      )}
    </div>
  );
}
