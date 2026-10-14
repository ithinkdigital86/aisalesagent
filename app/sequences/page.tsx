import Link from 'next/link';
import { redirect } from 'next/navigation';

import { SendingBanner } from '@/components/sending/sending-banner';
import { parseSteps } from '@/lib/cadence/sequence';
import { loadSendStatus } from '@/lib/cadence/send-controls';
import { supabaseServer } from '@/lib/supabase/server';
import { SequenceManager, type EnrolledLead, type SequenceRow } from './sequence-manager';

export default async function SequencesPage() {
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

  const { data: sequences } = await db
    .from('sequences')
    .select('id, name, steps, active, sent_count, reply_count, meeting_count')
    .eq('workspace_id', workspace.id)
    .order('created_at', { ascending: true });

  // Every lead currently attached to a sequence, running or stopped. The page
  // exists to answer "who is on which step", so a stopped run is shown rather
  // than hidden: "stopped on reply" is the most useful row on the page.
  const { data: leads } = await db
    .from('leads')
    .select(
      'id, full_name, company_name, stage, assigned_sequence_id, sequence_step, sequence_stopped_reason, next_action_at'
    )
    .eq('workspace_id', workspace.id)
    .not('assigned_sequence_id', 'is', null)
    .order('next_action_at', { ascending: true, nullsFirst: false })
    .limit(500);

  const sending = await loadSendStatus(db, workspace.id).catch(() => null);

  const rows: SequenceRow[] = (sequences ?? []).map((sequence) => ({
    id: sequence.id,
    name: sequence.name,
    active: sequence.active,
    steps: parseSteps(sequence.steps),
    sentCount: sequence.sent_count,
    replyCount: sequence.reply_count,
    meetingCount: sequence.meeting_count,
  }));

  const enrolled: EnrolledLead[] = (leads ?? []).map((lead) => ({
    id: lead.id,
    name: lead.full_name ?? lead.company_name ?? 'Unnamed lead',
    company: lead.company_name,
    stage: lead.stage as string,
    sequenceId: lead.assigned_sequence_id as string,
    step: lead.sequence_step,
    stoppedReason: lead.sequence_stopped_reason,
    nextActionAt: lead.next_action_at,
  }));

  return (
    <main className="mx-auto flex min-h-svh max-w-5xl flex-col gap-8 px-6 py-16">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="inline-block size-3 rounded-full bg-primary" aria-hidden />
          <span className="font-mono text-xs uppercase tracking-widest text-muted-foreground">
            Sequences
          </span>
        </div>
        <Link href="/" className="text-sm text-muted-foreground underline underline-offset-4">
          Back
        </Link>
      </header>

      <div className="space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight">Sequences</h1>
        <p className="text-muted-foreground">
          An ordered set of steps, at most four. Each step names a channel, how many days to wait
          after the step before it, and whether a human approves it before it goes. Put leads on a
          sequence from the{' '}
          <Link href="/leads" className="text-foreground underline underline-offset-4">
            leads page
          </Link>
          ; the send queue drives the steps from there.
        </p>
      </div>

      <SendingBanner status={sending} />

      <SequenceManager workspaceId={workspace.id} sequences={rows} enrolled={enrolled} />
    </main>
  );
}
