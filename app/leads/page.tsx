import Link from 'next/link';
import { redirect } from 'next/navigation';

import { loadActiveIcp } from '@/lib/cadence/icp';
import { supabaseServer } from '@/lib/supabase/server';
import { LeadsTable } from './leads-table';

const STAGES = [
  'sourced',
  'qualified',
  'parked',
  'contacted',
  'engaged',
  'meeting_booked',
  'won',
  'lost',
  'suppressed',
] as const;

type SearchParams = { stage?: string; sort?: string };

export default async function LeadsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const stage =
    typeof params.stage === 'string' && (STAGES as readonly string[]).includes(params.stage)
      ? params.stage
      : 'all';
  const sort = params.sort === 'fit_asc' ? 'fit_asc' : 'fit_desc';

  const db = await supabaseServer();
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) redirect('/login');

  const { data: workspace } = await db
    .from('workspaces')
    .select('id')
    .eq('owner_id', user.id)
    .limit(1)
    .maybeSingle();
  if (!workspace) redirect('/');

  let query = db
    .from('leads')
    .select(
      'id, full_name, company_name, title, stage, fit_score, fit_reasoning, email, icp_profile_id, icp:icp_profiles(name, active)'
    )
    .eq('workspace_id', workspace.id);
  if (stage !== 'all') query = query.eq('stage', stage);
  const { data: leads } = await query
    .order('fit_score', { ascending: sort === 'fit_asc', nullsFirst: false })
    .limit(100);

  const activeIcp = await loadActiveIcp(db, workspace.id);

  // The join comes back as an object or a one-element array depending on how
  // PostgREST resolves the relationship, so flatten it once here rather than in
  // the table.
  const rows = (leads ?? []).map((lead) => {
    const joined = Array.isArray(lead.icp) ? lead.icp[0] : lead.icp;
    return {
      id: lead.id,
      full_name: lead.full_name,
      company_name: lead.company_name,
      title: lead.title,
      stage: lead.stage as string,
      fit_score: lead.fit_score,
      fit_reasoning: lead.fit_reasoning,
      email: lead.email,
      icp_name: joined?.name ?? null,
      /** A score made against a profile that is no longer the active one. */
      icp_stale: joined ? joined.active !== true : false,
    };
  });

  return (
    <main className="mx-auto flex min-h-svh max-w-5xl flex-col gap-8 px-6 py-16">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="inline-block size-3 rounded-full bg-primary" aria-hidden />
          <span className="font-mono text-xs uppercase tracking-widest text-muted-foreground">
            Leads
          </span>
        </div>
        <Link href="/" className="text-sm text-muted-foreground underline underline-offset-4">
          Back
        </Link>
      </header>

      <div className="space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight">Leads</h1>
        <p className="text-muted-foreground">
          Sort by fit score, filter by stage, then run the Qualifier on a selection to score it.
        </p>
      </div>

      {activeIcp ? (
        <div className="rounded-lg border px-4 py-3 text-sm">
          <span className="font-medium text-foreground">Scoring against: </span>
          <span className="text-muted-foreground">{activeIcp.name}</span>
          <Link href="/icp" className="ml-2 text-muted-foreground underline underline-offset-4">
            Change
          </Link>
        </div>
      ) : (
        <div className="rounded-lg border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm">
          <span className="font-medium text-foreground">No active ideal customer profile. </span>
          <span className="text-muted-foreground">
            The Qualifier has nothing to score against and will refuse to run.{' '}
          </span>
          <Link href="/icp" className="text-foreground underline underline-offset-4">
            Create one
          </Link>
        </div>
      )}

      <LeadsTable workspaceId={workspace.id} leads={rows} stage={stage} sort={sort} />
    </main>
  );
}
