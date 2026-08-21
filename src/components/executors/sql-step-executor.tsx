'use client';

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Loader2, Play, CheckCircle, XCircle, Search } from 'lucide-react';
import { agentBridge, type ExecutionResult, type PodInfo } from '@/lib/services/agent-bridge';
import { getCustomerSqlConfig } from '@/lib/actions/customers';
import {
  getLastScriptExecution,
  saveScriptExecution,
} from '@/lib/actions/step-executions';

interface SqlExecutorProps {
  stepId: number;
  customerId: number;
  releaseId: number;
  content: string;
  namespace: string;
  kubeContext?: string;
}

type SqlClient = 'auto' | 'mysql' | 'psql';

const ENV_VAR_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

// Extract the schema/database from the connection string INSIDE the container —
// the DSN (credentials included) never leaves the pod, only the db name comes back
function buildDetectSchemaScript(envVar: string): string {
  return `DSN="\${${envVar}:?env var ${envVar} is not set}"
rest="\${DSN#*://}"
hostpart="\${rest#*@}"
dbpath=""
case "$hostpart" in */*) dbpath="\${hostpart#*/}" ;; esac
printf '%s' "\${dbpath%%\\?*}"
`;
}

// Build the in-container script: parse $ENV_VAR (scheme://user:pass@host:port/db),
// then run the client with the SQL on stdin via a quoted heredoc (verbatim, no
// shell expansion). A schema override replaces the db parsed from the DSN.
// Known limitation: passwords containing '@' or ':' break the naive parse.
function buildSqlScript(envVar: string, client: SqlClient, schema: string, content: string): string {
  const delim = content.includes('RT_SQL_EOF') ? 'RT_SQL_EOF_X9' : 'RT_SQL_EOF';
  const schemaAssign = schema ? `db='${schema.replace(/'/g, `'\\''`)}'` : '';
  return `set -e
DSN="\${${envVar}:?env var ${envVar} is not set}"
rest="\${DSN#*://}"
scheme="\${DSN%%://*}"
[ "$scheme" = "$DSN" ] && scheme=""
userpass="\${rest%%@*}"
hostpart="\${rest#*@}"
hostport="\${hostpart%%/*}"
dbpath=""
case "$hostpart" in */*) dbpath="\${hostpart#*/}" ;; esac
db="\${dbpath%%\\?*}"
host="\${hostport%%:*}"
port="\${hostport##*:}"
[ "$port" = "$hostport" ] && port=""
user="\${userpass%%:*}"
pass="\${userpass#*:}"
[ "$pass" = "$userpass" ] && pass=""
${schemaAssign}
client="${client}"
if [ "$client" = "auto" ]; then
  case "$scheme" in
    mysql*|mariadb*) client=mysql ;;
    postgres*|pgsql*) client=psql ;;
    *) echo "Cannot detect SQL client from DSN scheme: '$scheme'" >&2; exit 1 ;;
  esac
fi
if [ "$client" = "mysql" ]; then
  MYSQL_PWD="$pass" mysql -h"$host" -P"\${port:-3306}" -u"$user" \${db:+"$db"} <<'${delim}'
${content}
${delim}
elif [ "$client" = "psql" ]; then
  PGPASSWORD="$pass" psql -h "$host" -p "\${port:-5432}" -U "$user" \${db:+-d "$db"} -v ON_ERROR_STOP=1 <<'${delim}'
${content}
${delim}
fi
`;
}

function toDisplayResult(last: {
  success: boolean;
  exitCode?: number | null;
  duration: number;
  stdout: string;
  stderr: string;
  errorMessage?: string;
}): ExecutionResult {
  return {
    success: last.success,
    executionId: '',
    type: 'script',
    exitCode: last.exitCode ?? undefined,
    duration: last.duration,
    timestamp: '',
    script: {
      stdout: last.stdout,
      stderr: last.stderr,
      exitCode: last.exitCode ?? (last.success ? 0 : 1),
      command: '',
    },
    error: last.success
      ? undefined
      : { code: 'FAILED', message: last.errorMessage || 'Failed' },
  };
}

export function SqlExecutor({ stepId, customerId, releaseId, content, namespace, kubeContext }: SqlExecutorProps) {
  // agentBridge only exists in the browser; defer the check until after mount
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const available = mounted && !!agentBridge?.isAvailable();

  const [pods, setPods] = useState<PodInfo[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [podName, setPodName] = useState('');
  const [containerName, setContainerName] = useState('');
  const [envVar, setEnvVar] = useState('CRM_DB');
  const [client, setClient] = useState<SqlClient>('auto');
  const [schema, setSchema] = useState('');
  const [isDetecting, setIsDetecting] = useState(false);
  const [isExecuting, setIsExecuting] = useState(false);
  const [result, setResult] = useState<ExecutionResult | null>(null);
  const [execError, setExecError] = useState<string | null>(null);
  const [completedAt, setCompletedAt] = useState<string | null>(null);
  const [restoredTarget, setRestoredTarget] = useState<{
    podName?: string;
    containerName?: string;
  } | null>(null);
  const [configLoaded, setConfigLoaded] = useState(false);
  const [restoreReady, setRestoreReady] = useState(false);

  // Per-customer defaults (env var name, client) if configured
  useEffect(() => {
    getCustomerSqlConfig(customerId)
      .then((cfg) => {
        if (cfg) {
          if (cfg.connectionEnvVar) setEnvVar(cfg.connectionEnvVar);
          if (cfg.sqlClient === 'mysql' || cfg.sqlClient === 'psql') setClient(cfg.sqlClient);
        }
      })
      .catch(() => {})
      .finally(() => setConfigLoaded(true));
  }, [customerId]);

  // Restore last execution (output + SQL options) after customer defaults load,
  // so a prior run's env/client/schema win over the customer default
  useEffect(() => {
    if (!configLoaded) return;
    getLastScriptExecution(stepId, 'sql')
      .then((last) => {
        if (!last) return;
        setResult(toDisplayResult(last));
        setCompletedAt(last.completedAt);
        const req = last.request as {
          podName?: string;
          containerName?: string;
          envVar?: string;
          client?: SqlClient;
          schema?: string;
        };
        setRestoredTarget({ podName: req.podName, containerName: req.containerName });
        if (req.envVar) setEnvVar(req.envVar);
        if (req.client === 'auto' || req.client === 'mysql' || req.client === 'psql') {
          setClient(req.client);
        }
        if (typeof req.schema === 'string') setSchema(req.schema);
      })
      .catch(() => {})
      .finally(() => setRestoreReady(true));
  }, [stepId, configLoaded]);

  // Load the namespace's pods once the extension is available
  useEffect(() => {
    if (!available || !agentBridge) return;
    agentBridge
      .getPods({ customerId, namespace, podSelector: '', kubeContext, stepId, releaseId })
      .then((res) => {
        if (res.success && res.pods) {
          setPods(res.pods.items);
        } else {
          setLoadError(res.error?.message || 'Failed to load pods');
        }
      })
      .catch((err) => setLoadError(err instanceof Error ? err.message : 'Failed to load pods'));
  }, [available, customerId, namespace, kubeContext, stepId, releaseId]);

  // Prefer last-run pod/container when still present; otherwise pick the only pod
  useEffect(() => {
    if (!restoreReady || !pods?.length || podName) return;
    const restoredPod = restoredTarget?.podName;
    if (restoredPod && pods.some((p) => p.name === restoredPod)) {
      setPodName(restoredPod);
      const pod = pods.find((p) => p.name === restoredPod);
      const restoredContainer = restoredTarget?.containerName;
      if (restoredContainer && pod?.containers.some((c) => c.name === restoredContainer)) {
        setContainerName(restoredContainer);
      } else if (pod?.containers.length === 1) {
        setContainerName(pod.containers[0].name);
      }
    } else if (pods.length === 1) {
      setPodName(pods[0].name);
      if (pods[0].containers.length === 1) {
        setContainerName(pods[0].containers[0].name);
      }
    }
  }, [pods, restoredTarget, podName, restoreReady]);

  const selectedPod = pods?.find((p) => p.name === podName) || null;
  const containers = selectedPod?.containers || [];

  const handlePodChange = (name: string) => {
    setPodName(name);
    const pod = pods?.find((p) => p.name === name);
    setContainerName(pod?.containers.length === 1 ? pod.containers[0].name : '');
  };

  const runScript = async (script: string) => {
    if (!agentBridge || !podName) throw new Error('No pod selected');
    return agentBridge.executeScript(
      {
        customerId,
        namespace,
        podSelector: '',
        podName,
        containerName: containerName || undefined,
        kubeContext,
        stepId,
        releaseId,
      },
      { interpreter: 'sh', content: script }
    );
  };

  const handleDetect = async () => {
    setIsDetecting(true);
    setExecError(null);
    try {
      const res = await runScript(buildDetectSchemaScript(envVar));
      const db = res.script?.stdout?.trim();
      if (res.success && db) {
        setSchema(db);
      } else {
        setExecError(res.error?.message || 'Could not extract a schema from the connection string');
      }
    } catch (err) {
      setExecError(err instanceof Error ? err.message : 'Detect failed');
    } finally {
      setIsDetecting(false);
    }
  };

  const handleExecute = async () => {
    if (!ENV_VAR_RE.test(envVar)) {
      setExecError(`Invalid env var name: "${envVar}"`);
      return;
    }
    setIsExecuting(true);
    setResult(null);
    setExecError(null);
    setCompletedAt(null);

    try {
      const executionResult = await runScript(buildSqlScript(envVar, client, schema.trim(), content));
      setResult(executionResult);
      setCompletedAt(new Date().toISOString());

      try {
        await saveScriptExecution({
          stepId,
          customerId,
          releaseId,
          type: 'sql',
          request: {
            podName,
            containerName: containerName || undefined,
            kubeContext,
            namespace,
            envVar,
            client,
            schema: schema.trim(),
          },
          success: executionResult.success,
          exitCode: executionResult.exitCode ?? executionResult.script?.exitCode,
          duration: executionResult.duration,
          stdout: executionResult.script?.stdout,
          stderr: executionResult.script?.stderr,
          errorMessage: executionResult.error?.message,
        });
      } catch (persistErr) {
        console.error('Failed to save SQL execution:', persistErr);
      }
    } catch (err) {
      setExecError(err instanceof Error ? err.message : 'Execution failed');
    } finally {
      setIsExecuting(false);
    }
  };

  if (!mounted) return null;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center justify-between text-base">
          <Badge variant="outline" className="bg-blue-50">SQL Execute</Badge>
          {available && (
            <Button
              size="sm"
              onClick={handleExecute}
              disabled={isExecuting || isDetecting || !podName || (containers.length > 1 && !containerName)}
              className="bg-green-600 hover:bg-green-700"
            >
              {isExecuting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Play className="h-4 w-4" />
              )}
              <span className="ml-2">Execute</span>
            </Button>
          )}
        </CardTitle>
      </CardHeader>

      <CardContent className="space-y-4">
        {!available && (
          <p className="text-sm text-amber-700 bg-amber-50 rounded-md p-3">
            Agent extension not detected. Install the browser extension and start the local
            agent to execute this step in the cluster.
          </p>
        )}

        {available && loadError && (
          <div className="p-3 bg-red-50 text-red-600 rounded-md text-sm">
            {loadError}
          </div>
        )}

        {available && !loadError && pods === null && (
          <div className="flex items-center gap-2 text-sm text-slate-500">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading pods in {namespace}...
          </div>
        )}

        {available && pods && pods.length === 0 && (
          <p className="text-sm text-slate-500">No pods found in namespace {namespace}.</p>
        )}

        {available && pods && pods.length > 0 && (
          <>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Pod</Label>
                <Select value={podName} onValueChange={handlePodChange} disabled={isExecuting}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select a pod" />
                  </SelectTrigger>
                  <SelectContent>
                    {pods.map((p) => (
                      <SelectItem key={p.name} value={p.name}>
                        {p.name} ({p.status})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {containers.length > 1 ? (
                <div className="space-y-2">
                  <Label>Container</Label>
                  <Select value={containerName} onValueChange={setContainerName} disabled={isExecuting}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select a container" />
                    </SelectTrigger>
                    <SelectContent>
                      {containers.map((c) => (
                        <SelectItem key={c.name} value={c.name}>{c.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ) : <div />}
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Connection env var</Label>
                <Input
                  value={envVar}
                  onChange={(e) => setEnvVar(e.target.value)}
                  placeholder="CRM_DB"
                  disabled={isExecuting}
                />
              </div>

              <div className="space-y-2">
                <Label>Client</Label>
                <Select value={client} onValueChange={(v) => setClient(v as SqlClient)} disabled={isExecuting}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="auto">Auto (from DSN scheme)</SelectItem>
                    <SelectItem value="mysql">mysql</SelectItem>
                    <SelectItem value="psql">psql</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <Label>Schema / database</Label>
              <div className="flex items-center gap-2">
                <Input
                  value={schema}
                  onChange={(e) => setSchema(e.target.value)}
                  placeholder="From connection string (editable)"
                  disabled={isExecuting}
                />
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleDetect}
                  disabled={isExecuting || isDetecting || !podName}
                >
                  {isDetecting ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Search className="h-4 w-4" />
                  )}
                  <span className="ml-2">Detect</span>
                </Button>
              </div>
              <p className="text-xs text-slate-500">
                Extracted from the env var inside the container — the connection string itself never leaves the pod.
              </p>
            </div>
          </>
        )}

        {execError && (
          <div className="p-3 bg-red-50 text-red-600 rounded-md text-sm">
            {execError}
          </div>
        )}

        {result && (
          <div className={`rounded-md p-4 ${result.success ? 'bg-green-50' : 'bg-red-50'}`}>
            <div className="flex items-center gap-2 mb-2">
              {result.success ? (
                <CheckCircle className="h-5 w-5 text-green-600" />
              ) : (
                <XCircle className="h-5 w-5 text-red-600" />
              )}
              <span className={result.success ? 'text-green-800' : 'text-red-800'}>
                {result.success ? 'Success' : (result.error?.message || 'Failed')}
                {result.exitCode !== undefined && ` (Exit Code: ${result.exitCode})`}
              </span>
              <span className="text-slate-500 text-sm ml-auto">
                {completedAt ? `${new Date(completedAt).toLocaleString()} · ` : ''}
                {result.duration}ms
              </span>
            </div>

            {result.script?.stdout && (
              <div className="mt-2">
                <p className="text-xs font-medium text-slate-500 mb-1">Output:</p>
                <pre className="text-xs bg-white/50 p-2 rounded overflow-x-auto max-h-60 font-mono">
                  {result.script.stdout}
                </pre>
              </div>
            )}

            {result.script?.stderr && (
              <div className="mt-2">
                <p className="text-xs font-medium text-red-600 mb-1">Stderr:</p>
                <pre className="text-xs bg-white/50 p-2 rounded overflow-x-auto max-h-40 text-red-700 font-mono">
                  {result.script.stderr}
                </pre>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
