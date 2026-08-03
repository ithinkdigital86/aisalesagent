'use client';

import { useTransition } from 'react';

import { signOut } from '@/app/actions/auth';
import { Button } from '@/components/ui/button';

export function SignOutButton() {
  const [pending, startTransition] = useTransition();

  return (
    <Button
      variant="outline"
      size="sm"
      disabled={pending}
      onClick={() => startTransition(() => void signOut())}
    >
      {pending ? 'Signing out' : 'Sign out'}
    </Button>
  );
}
