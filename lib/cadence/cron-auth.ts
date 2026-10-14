// lib/cadence/cron-auth.ts
//
// The check every cron route makes before doing anything. Vercel sends
// `Authorization: Bearer <CRON_SECRET>` on each scheduled call.
//
// An unset secret refuses everything rather than comparing against it: the
// template string would read "Bearer undefined", and that literal header would
// then let anyone run every workspace's crons.

export function isCronRequest(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return request.headers.get('authorization') === `Bearer ${secret}`;
}
