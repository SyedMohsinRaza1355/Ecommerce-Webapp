/** Time helpers kept out of React render functions. */
export const hoursAgo = (h: number, now = Date.now()) => new Date(now - h * 3600_000);

/** "just now", "5 min ago", "3 h ago", "2 days ago": easier to scan than a full date in a busy list. */
export function ago(d: Date | string, now = Date.now()): string {
  const s = Math.max(0, Math.floor((now - new Date(d).getTime()) / 1000));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  const days = Math.floor(s / 86400);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

/** True when something has waited longer than `minutes`. */
export const olderThan = (d: Date | string, minutes: number, now = Date.now()) => now - new Date(d).getTime() > minutes * 60_000;
