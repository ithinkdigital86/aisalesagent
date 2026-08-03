import Link from 'next/link';
import { redirect } from 'next/navigation';

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
    .select('id, full_name, company_name, title, stage, fit_score, fit_reasoning, email')
    .eq('workspace_id', workspace.id);
  if (stage !== 'all') query = query.eq('stage', stage);
  const { data: leads } = await query
    .order('fit_score', { ascending: sort === 'fit_asc', nullsFirst: false })
    .limit(100);

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

      <LeadsTable workspaceId={workspace.id} leads={leads ?? []} stage={stage} sort={sort} />
    </main>
  );
}
