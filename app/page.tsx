import { redirect } from 'next/navigation';

import { ensureWorkspace } from '@/app/actions/auth';
import { SignOutButton } from '@/components/auth/sign-out-button';
import { supabaseServer } from '@/lib/supabase/server';

const WORKSPACE_COLUMNS = 'id, name, jurisdictions, dlt_registered';

export default async function Home() {
  const db = await supabaseServer();
  const {
    data: { user },
  } = await db.auth.getUser();
  // Middleware already guards this, but keep the page honest on its own.
  if (!user) redirect('/login');

  let { data: workspace } = await db
    .from('workspaces')
    .select(WORKSPACE_COLUMNS)
    .eq('owner_id', user.id)
    .limit(1)
    .maybeSingle();

  // Safety net for any sign-in path that skipped the bootstrap step.
  if (!workspace) {
    await ensureWorkspace();
    ({ data: workspace } = await db
      .from('workspaces')
      .select(WORKSPACE_COLUMNS)
      .eq('owner_id', user.id)
      .limit(1)
      .maybeSingle());
  }

  return (
    <main className="mx-auto flex min-h-svh max-w-3xl flex-col gap-8 px-6 py-16">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="inline-block size-3 rounded-full bg-primary" aria-hidden />
          <span className="font-mono text-xs uppercase tracking-widest text-muted-foreground">
            Cadence
          </span>
        </div>
        <SignOutButton />
      </header>

      <div className="space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight">
          {workspace?.name ?? 'Your workspace'}
        </h1>
        <p className="text-muted-foreground">Signed in as {user.email}</p>
      </div>

      <dl className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-lg border p-4">
          <dt className="text-sm text-muted-foreground">Jurisdictions</dt>
          <dd className="mt-1 font-mono text-sm">
            {workspace?.jurisdictions?.join(', ') ?? 'IN'}
          </dd>
        </div>
        <div className="rounded-lg border p-4">
          <dt className="text-sm text-muted-foreground">DLT registered</dt>
          <dd className="mt-1 font-mono text-sm">{workspace?.dlt_registered ? 'yes' : 'no'}</dd>
        </div>
      </dl>
    </main>
  );
}
