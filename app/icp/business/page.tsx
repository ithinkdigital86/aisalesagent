import Link from 'next/link';
import { redirect } from 'next/navigation';

import { loadBusinessProfile } from '@/lib/cadence/business-profile';
import { supabaseServer } from '@/lib/supabase/server';
import { BusinessProfileForm } from './business-profile-form';

export default async function BusinessProfilePage() {
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

  const profile = await loadBusinessProfile(db, workspace.id);

  return (
    <main className="mx-auto flex min-h-svh max-w-4xl flex-col gap-8 px-6 py-16">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="inline-block size-3 rounded-full bg-primary" aria-hidden />
          <span className="font-mono text-xs uppercase tracking-widest text-muted-foreground">
            Business profile
          </span>
        </div>
        <Link href="/icp" className="text-sm text-muted-foreground underline underline-offset-4">
          Back to ICP
        </Link>
      </header>

      <div className="space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight">Business profile</h1>
        <p className="text-muted-foreground">
          What {workspace.name} does, in your own words. The ICP strategist reads this, and only
          this, when it proposes customer profiles. The more of it is filled in, the less it has to
          assume.
        </p>
      </div>

      <BusinessProfileForm workspaceId={workspace.id} profile={profile} />
    </main>
  );
}
