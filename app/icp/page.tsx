import Link from 'next/link';
import { redirect } from 'next/navigation';

import { parseFilters } from '@/lib/cadence/icp';
import type { IcpFiltersShape } from '@/lib/cadence/icp-shape';
import { supabaseServer } from '@/lib/supabase/server';
import { IcpManager, type IcpRecord } from './icp-manager';

export default async function IcpPage() {
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

  const { data: profiles } = await db
    .from('icp_profiles')
    .select('id, name, offer, filters, trigger_types, active, updated_at')
    .eq('workspace_id', workspace.id)
    .order('active', { ascending: false })
    .order('updated_at', { ascending: false })
    .limit(50);

  const records: IcpRecord[] = (profiles ?? []).map((profile) => ({
    id: profile.id,
    name: profile.name,
    offer: profile.offer,
    active: profile.active,
    updatedAt: profile.updated_at,
    triggerTypes: profile.trigger_types ?? [],
    filters: parseFilters(profile.filters) as IcpFiltersShape,
  }));

  return (
    <main className="mx-auto flex min-h-svh max-w-4xl flex-col gap-8 px-6 py-16">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="inline-block size-3 rounded-full bg-primary" aria-hidden />
          <span className="font-mono text-xs uppercase tracking-widest text-muted-foreground">
            ICP
          </span>
        </div>
        <Link href="/" className="text-sm text-muted-foreground underline underline-offset-4">
          Back
        </Link>
      </header>

      <div className="space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight">Ideal customer profile</h1>
        <p className="text-muted-foreground">
          The Qualifier scores every lead against the active profile, and the Content Creator writes
          from its offer description. Without one the Qualifier has nothing to score against and
          refuses to run.
        </p>
      </div>

      <IcpManager workspaceId={workspace.id} profiles={records} />
    </main>
  );
}
