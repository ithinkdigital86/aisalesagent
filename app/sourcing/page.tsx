import Link from 'next/link';
import { redirect } from 'next/navigation';

import { supabaseServer } from '@/lib/supabase/server';
import { SourcingForm } from './sourcing-form';

export default async function SourcingPage() {
  const db = await supabaseServer();
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) redirect('/login');

  const { data: workspace } = await db
    .from('workspaces')
    .select('id, name')
    .eq('owner_id', user.id)
    .limit(1)
    .maybeSingle();
  if (!workspace) redirect('/');

  const { data: runs } = await db
    .from('sourcing_runs')
    .select(
      'id, returned_count, inserted_count, duplicate_count, suppressed_count, credits_used, error, created_at'
    )
    .eq('workspace_id', workspace.id)
    .order('created_at', { ascending: false })
    .limit(5);

  return (
    <main className="mx-auto flex min-h-svh max-w-3xl flex-col gap-8 px-6 py-16">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="inline-block size-3 rounded-full bg-primary" aria-hidden />
          <span className="font-mono text-xs uppercase tracking-widest text-muted-foreground">
            Sourcing
          </span>
        </div>
        <Link href="/" className="text-sm text-muted-foreground underline underline-offset-4">
          Back
        </Link>
      </header>

      <div className="space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight">Source leads from Apollo</h1>
        <p className="text-muted-foreground">
          Define an ideal customer profile and run it. Every result passes the enrich and dedupe
          gate before it becomes a lead, and an identical search inside the cache window spends no
          Apollo credits.
        </p>
      </div>

      <SourcingForm workspaceId={workspace.id} />

      {runs && runs.length > 0 ? (
        <section className="space-y-3">
          <h2 className="text-sm font-medium text-muted-foreground">Recent runs</h2>
          <ul className="divide-y rounded-lg border">
            {runs.map((run) => (
              <li
                key={run.id}
                className="flex items-center justify-between gap-4 px-4 py-3 text-sm"
              >
                <span className="font-mono text-xs text-muted-foreground">
                  {new Date(run.created_at).toLocaleString()}
                </span>
                <span className="text-right">
                  {run.error ? (
                    <span className="text-destructive">{run.error}</span>
                  ) : (
                    `${run.inserted_count} added, ${run.duplicate_count} dupes, ${run.suppressed_count} skipped, ${run.credits_used} credits`
                  )}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </main>
  );
}
