import Link from 'next/link';
import { redirect } from 'next/navigation';

import { ensureWorkspace } from '@/app/actions/auth';
import { RunButtons } from '@/components/dashboard/run-buttons';
import { SignOutButton } from '@/components/auth/sign-out-button';
import { supabaseServer } from '@/lib/supabase/server';

const STAGE_ORDER = [
  'sourced',
  'qualified',
  'parked',
  'contacted',
  'engaged',
  'meeting_booked',
  'won',
  'lost',
  'suppressed',
];

// Approximate USD per 1M tokens, for an at-a-glance spend estimate only.
const PRICES: Record<string, { input: number; output: number }> = {
  'claude-opus-5': { input: 15, output: 75 },
  'claude-haiku-4-5-20251001': { input: 1, output: 5 },
};

type SalesManagerOutput = {
  headline?: string;
  pipeline_health?: string;
  bottleneck?: string;
  actions?: Array<{ instruction: string; target_agent: string; priority: string }>;
  needs_human?: string[];
};

export default async function Home() {
  const db = await supabaseServer();
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) redirect('/login');

  let { data: workspace } = await db
    .from('workspaces')
    .select('id, name, jurisdictions, dlt_registered')
    .eq('owner_id', user.id)
    .limit(1)
    .maybeSingle();
  if (!workspace) {
    await ensureWorkspace();
    ({ data: workspace } = await db
      .from('workspaces')
      .select('id, name, jurisdictions, dlt_registered')
      .eq('owner_id', user.id)
      .limit(1)
      .maybeSingle());
  }
  const workspaceId = workspace?.id as string;

  const [{ data: leads }, { data: actions }, { data: runs }, { data: sm }] = await Promise.all([
    db.from('leads').select('stage').eq('workspace_id', workspaceId),
    db.from('actions').select('channel, status, replied_at').eq('workspace_id', workspaceId),
    db.from('agent_runs').select('model, input_tokens, output_tokens').eq('workspace_id', workspaceId),
    db
      .from('agent_runs')
      .select('raw_output, created_at')
      .eq('workspace_id', workspaceId)
      .eq('agent', 'sales_manager')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  const totalLeads = leads?.length ?? 0;
  const byStage: Record<string, number> = {};
  for (const lead of leads ?? []) byStage[lead.stage] = (byStage[lead.stage] ?? 0) + 1;

  const channels: Record<string, { sent: number; replied: number }> = {};
  let queuedEmails = 0;
  let awaiting = 0;
  for (const action of actions ?? []) {
    const channel = action.channel as string;
    channels[channel] ??= { sent: 0, replied: 0 };
    if (action.status === 'sent') channels[channel].sent += 1;
    if (action.replied_at) channels[channel].replied += 1;
    if (action.status === 'queued' && channel === 'email') queuedEmails += 1;
    if (action.status === 'awaiting_approval') awaiting += 1;
  }

  let estimatedSpend = 0;
  for (const run of runs ?? []) {
    const price = PRICES[run.model as string] ?? PRICES['claude-haiku-4-5-20251001'];
    estimatedSpend +=
      ((run.input_tokens as number) / 1_000_000) * price.input +
      ((run.output_tokens as number) / 1_000_000) * price.output;
  }

  const manager = (sm?.raw_output ?? null) as SalesManagerOutput | null;
  const channelRows = Object.entries(channels).filter(([, v]) => v.sent > 0);

  return (
    <main className="mx-auto flex min-h-svh max-w-5xl flex-col gap-8 px-6 py-14">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="inline-block size-3 rounded-full bg-primary" aria-hidden />
          <span className="font-mono text-xs uppercase tracking-widest text-muted-foreground">
            Cadence
          </span>
        </div>
        <SignOutButton />
      </header>

      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-3xl font-semibold tracking-tight">{workspace?.name ?? 'Workspace'}</h1>
          <p className="text-sm text-muted-foreground">Signed in as {user.email}</p>
        </div>
        <RunButtons workspaceId={workspaceId} />
      </div>

      <nav className="flex flex-wrap gap-3">
        {[
          { href: '/sourcing', label: 'Sourcing' },
          { href: '/leads', label: 'Leads' },
          { href: '/approvals', label: `Approvals${awaiting ? ` (${awaiting})` : ''}` },
        ].map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className="rounded-md border px-3 py-1.5 text-sm transition-colors hover:bg-accent hover:text-accent-foreground"
          >
            {item.label}
          </Link>
        ))}
      </nav>

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Leads" value={String(totalLeads)} />
        <StatTile label="Queued emails" value={String(queuedEmails)} />
        <StatTile label="Awaiting approval" value={String(awaiting)} />
        <StatTile label="Agent spend (est.)" value={`$${estimatedSpend.toFixed(2)}`} />
      </section>

      <section className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-xl border p-5">
          <h2 className="mb-4 text-sm font-medium text-muted-foreground">Pipeline by stage</h2>
          {totalLeads === 0 ? (
            <p className="text-sm text-muted-foreground">
              No leads yet.{' '}
              <Link href="/sourcing" className="text-foreground underline underline-offset-4">
                Source some
              </Link>
              .
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {STAGE_ORDER.filter((stage) => (byStage[stage] ?? 0) > 0).map((stage) => {
                const count = byStage[stage] ?? 0;
                const pct = Math.round((count / totalLeads) * 100);
                return (
                  <li key={stage} className="flex items-center gap-3 text-sm">
                    <span className="w-28 shrink-0 font-mono text-xs text-muted-foreground">
                      {stage}
                    </span>
                    <span className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                      <span
                        className="block h-full rounded-full bg-primary"
                        style={{ width: `${Math.max(pct, 3)}%` }}
                      />
                    </span>
                    <span className="w-10 shrink-0 text-right font-mono text-xs">{count}</span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="rounded-xl border p-5">
          <h2 className="mb-4 text-sm font-medium text-muted-foreground">Reply rate by channel</h2>
          {channelRows.length === 0 ? (
            <p className="text-sm text-muted-foreground">No sends yet.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {channelRows.map(([channel, stats]) => {
                const rate = Math.round((stats.replied / stats.sent) * 100);
                return (
                  <li key={channel} className="flex items-center gap-3 text-sm">
                    <span className="w-24 shrink-0 font-mono text-xs text-muted-foreground">
                      {channel}
                    </span>
                    <span className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                      <span
                        className="block h-full rounded-full bg-primary"
                        style={{ width: `${Math.max(rate, 3)}%` }}
                      />
                    </span>
                    <span className="w-24 shrink-0 text-right font-mono text-xs">
                      {rate}% of {stats.sent}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </section>

      <section className="rounded-xl border p-5">
        <h2 className="mb-4 text-sm font-medium text-muted-foreground">Sales Manager</h2>
        {manager ? (
          <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center gap-3">
              <span className="rounded-md bg-primary px-2 py-0.5 font-mono text-xs text-primary-foreground">
                {manager.pipeline_health ?? 'unknown'}
              </span>
              <p className="text-base font-medium">{manager.headline}</p>
            </div>
            {manager.bottleneck ? (
              <p className="text-sm text-muted-foreground">
                <span className="font-medium text-foreground">Bottleneck: </span>
                {manager.bottleneck}
              </p>
            ) : null}
            {manager.actions && manager.actions.length > 0 ? (
              <ul className="flex flex-col gap-2">
                {manager.actions.map((item, index) => (
                  <li key={index} className="rounded-md border px-3 py-2 text-sm">
                    <span className="font-mono text-xs text-muted-foreground">
                      {item.priority} / {item.target_agent}
                    </span>
                    <p className="mt-0.5">{item.instruction}</p>
                  </li>
                ))}
              </ul>
            ) : null}
            {manager.needs_human && manager.needs_human.length > 0 ? (
              <div className="text-sm">
                <span className="font-medium">Needs a human: </span>
                {manager.needs_human.join('; ')}
              </div>
            ) : null}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            No read yet. Click Run Sales Manager to get today&apos;s review of the pipeline.
          </p>
        )}
      </section>

      <dl className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-lg border p-4">
          <dt className="text-sm text-muted-foreground">Jurisdictions</dt>
          <dd className="mt-1 font-mono text-sm">{workspace?.jurisdictions?.join(', ') ?? 'IN'}</dd>
        </div>
        <div className="rounded-lg border p-4">
          <dt className="text-sm text-muted-foreground">DLT registered</dt>
          <dd className="mt-1 font-mono text-sm">{workspace?.dlt_registered ? 'yes' : 'no'}</dd>
        </div>
      </dl>
    </main>
  );
}

function StatTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border p-4">
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-1 font-display text-2xl font-semibold tabular-nums">{value}</div>
    </div>
  );
}
