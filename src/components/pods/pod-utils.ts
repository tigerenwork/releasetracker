/**
 * Shared helpers for pod status displays
 */

export function formatRelativeTime(isoDate: string | null): string {
  if (!isoDate) return '—';
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(isoDate).getTime()) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${minutes % 60}m ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ${hours % 24}h ago`;
}

/** Badge color classes for a pod/container status */
export function statusBadgeClass(status: string): string {
  if (status === 'Running') {
    return 'bg-green-100 text-green-700 hover:bg-green-100';
  }
  if (status === 'Succeeded' || status === 'Completed') {
    return 'bg-slate-100 text-slate-600 hover:bg-slate-100';
  }
  if (status === 'Pending' || status === 'ContainerCreating' || status === 'PodInitializing' || status === 'Terminating') {
    return 'bg-amber-100 text-amber-700 hover:bg-amber-100';
  }
  // CrashLoopBackOff, ImagePullBackOff, ErrImagePull, Error, OOMKilled, Failed, ...
  return 'bg-red-100 text-red-700 hover:bg-red-100';
}

/** Whether a status indicates a problem (Completed job pods are fine) */
export function isUnhealthy(status: string): boolean {
  return status !== 'Running' && status !== 'Succeeded' && status !== 'Completed';
}
