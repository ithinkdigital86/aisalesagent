'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';

import { ensureWorkspace } from '@/app/actions/auth';
import { supabaseBrowser } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

type Mode = 'sign_in' | 'sign_up';

export function LoginForm() {
  const router = useRouter();
  const [mode, setMode] = React.useState<Mode>('sign_in');
  const [email, setEmail] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [pending, setPending] = React.useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    const supabase = supabaseBrowser();

    try {
      if (mode === 'sign_in') {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      } else {
        const { data, error } = await supabase.auth.signUp({ email, password });
        if (error) throw error;
        // When email confirmation is on, there is no session yet.
        if (!data.session) {
          toast.success('Check your email to confirm your account, then sign in.');
          setMode('sign_in');
          setPending(false);
          return;
        }
      }

      // First sign-in: make sure the tenant workspace exists before landing.
      const result = await ensureWorkspace();
      if (!result.ok) throw new Error(result.error ?? 'Could not set up your workspace');

      router.replace('/');
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Something went wrong');
      setPending(false);
    }
  }

  return (
    <Card className="w-full max-w-sm">
      <CardHeader>
        <CardTitle className="text-2xl">
          {mode === 'sign_in' ? 'Sign in to Cadence' : 'Create your account'}
        </CardTitle>
        <CardDescription>
          {mode === 'sign_in'
            ? 'Enter your email and password to continue.'
            : 'Sign up with an email and password to get started.'}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@company.com"
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              type="password"
              autoComplete={mode === 'sign_in' ? 'current-password' : 'new-password'}
              required
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="At least 8 characters"
            />
          </div>
          <Button type="submit" disabled={pending} className="mt-2">
            {pending ? 'Please wait' : mode === 'sign_in' ? 'Sign in' : 'Create account'}
          </Button>
        </form>
        <p className="mt-4 text-sm text-muted-foreground">
          {mode === 'sign_in' ? 'No account yet? ' : 'Already have an account? '}
          <button
            type="button"
            className="font-medium text-foreground underline underline-offset-4"
            onClick={() => setMode(mode === 'sign_in' ? 'sign_up' : 'sign_in')}
          >
            {mode === 'sign_in' ? 'Create one' : 'Sign in'}
          </button>
        </p>
      </CardContent>
    </Card>
  );
}
