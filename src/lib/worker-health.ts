import { db } from "./db";

export async function workerHealth() {
  const [row] = await db()`SELECT max(seen_at) last_seen,
    coalesce(max(seen_at)>clock_timestamp()-interval '11 minutes',false) available
    FROM worker_heartbeats`;
  return { workerLastSeen: row.last_seen, workerAvailable: row.available };
}
