import { redirect } from 'next/navigation';

import { supabaseServer } from '@/lib/supabase/server';
import { LoginForm } from './login-form';

export default async function LoginPage() {
  const db = await supabaseServer();
  const {
    data: { user },
  } = await db.auth.getUser();
  if (user) redirect('/');

  return (
    <main className="flex min-h-svh items-center justify-center px-6 py-16">
      <LoginForm />
    </main>
  );
}
