import Link from 'next/link';
import { redirect } from 'next/navigation';

import { supabaseServer } from '@/lib/supabase/server';
import { ApprovalsList } from './approvals-list';

export default async function ApprovalsPage() {
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

  const { data: actions } = await db
    .from('actions')
    .select('id, channel, subject, body, step_number, created_at, lead:leads(full_name, company_name)')
    .eq('workspace_id', workspace.id)
    .eq('status', 'awaiting_approval')
    .order('created_at', { ascending: true })
    .limit(100);

  return (
    <main className="mx-auto flex min-h-svh max-w-3xl flex-col gap-8 px-6 py-16">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="inline-block size-3 rounded-full bg-primary" aria-hidden />
          <span className="font-mono text-xs uppercase tracking-widest text-muted-foreground">
            Approvals
          </span>
        </div>
        <Link href="/" className="text-sm text-muted-foreground underline underline-offset-4">
          Back
        </Link>
      </header>

      <div className="space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight">Approval queue</h1>
        <p className="text-muted-foreground">
          Everything waiting on a human. Approve to send or hand off, edit the copy first, or
          reject. LinkedIn, Instagram, and voice always land here.
        </p>
      </div>

      <ApprovalsList actions={(actions ?? []) as never} />
    </main>
  );
}
