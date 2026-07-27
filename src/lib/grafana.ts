/**
 * Grafana Explore deep-link builder (Loki).
 * Pure functions — no DB or network access.
 */

export type GrafanaConnection = {
  baseUrl: string;
  datasourceUid: string;
};

/**
 * Derive the app name from a pod name. Pod names start with the app name:
 * drop the trailing pod-hash segment, and if what remains ends in a
 * replicaset/timestamp hash, drop that too:
 *   aldebaran-7dc485cffc-h1zkw        -> aldebaran
 *   a1-backend-856c8855d8-gbj8f       -> a1-backend
 *   salesforce-sync-29672220-6gsq8    -> salesforce-sync  (cronjob)
 */
export function appFromPodName(podName: string): string {
  const segments = podName.split('-');
  if (segments.length > 1) segments.pop();
  const last = segments[segments.length - 1];
  if (segments.length > 1 && (/^[a-z0-9]{8,10}$/.test(last) || /^\d{9,}$/.test(last))) {
    segments.pop();
  }
  return segments.join('-');
}

/** Build a Loki LogQL selector with optional line-contains filter */
export function buildLogExpr(opts: {
  app?: string;
  cluster?: string;
  namespace?: string;
  lineContains?: string;
}): string {
  const labels = [
    opts.app && `app="${opts.app}"`,
    opts.cluster && `cluster="${opts.cluster}"`,
    opts.namespace && `namespace="${opts.namespace}"`,
  ]
    .filter(Boolean)
    .join(', ');

  let expr = `{${labels}}`;
  const line = opts.lineContains?.trim();
  if (line) {
    expr += ` |= "${line.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
  }
  return expr;
}

/** Build a Grafana Explore URL with a single Loki query pane */
export function buildGrafanaExploreUrl(
  conn: GrafanaConnection,
  opts: { expr: string; from?: string; to?: string }
): string {
  const panes = {
    main: {
      datasource: conn.datasourceUid,
      queries: [
        {
          refId: 'A',
          expr: opts.expr,
          queryType: 'range',
          datasource: { type: 'loki', uid: conn.datasourceUid },
          editorMode: 'builder',
          maxLines: 5000,
        },
      ],
      range: { from: opts.from || 'now-1h', to: opts.to || 'now' },
    },
  };
  return `${conn.baseUrl.replace(/\/+$/, '')}/explore?schemaVersion=1&panes=${encodeURIComponent(
    JSON.stringify(panes)
  )}&orgId=1`;
}
