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

export function statusVariant(status: string): 'default' | 'secondary' | 'destructive' | 'outline' {
  if (status === 'Running' || status === 'Succeeded') return 'default';
  if (status === 'Pending' || status === 'Terminating') return 'secondary';
  return 'destructive'; // CrashLoopBackOff, Error, ImagePullBackOff, ...
}
