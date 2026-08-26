'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';

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

function toList(value: string): string[] {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

const EMPTY = {
  name: '',
  industries: '',
  titles: '',
  seniorities: '',
  geos: '',
  employeeMin: '',
  employeeMax: '',
  excludeDomains: '',
  limit: '25',
};

export function SourcingForm({ workspaceId }: { workspaceId: string }) {
  const router = useRouter();
  const [pending, setPending] = React.useState(false);
  const [form, setForm] = React.useState(EMPTY);

  function set(key: keyof typeof EMPTY) {
    return (event: React.ChangeEvent<HTMLInputElement>) =>
      setForm((current) => ({ ...current, [key]: event.target.value }));
  }

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);

    try {
      const filters: Record<string, unknown> = {};
      const industries = toList(form.industries);
      const titles = toList(form.titles);
      const seniorities = toList(form.seniorities);
      const geos = toList(form.geos);
      const excludeDomains = toList(form.excludeDomains);

      if (industries.length) filters.industries = industries;
      if (titles.length) filters.titles = titles;
      if (seniorities.length) filters.seniorities = seniorities;
      if (geos.length) filters.geos = geos;
      if (excludeDomains.length) filters.exclusions = { domains: excludeDomains };

      const min = form.employeeMin ? Number(form.employeeMin) : undefined;
      const max = form.employeeMax ? Number(form.employeeMax) : undefined;
      if (min !== undefined && max !== undefined) filters.employee_range = [min, max];

      const response = await fetch('/api/sourcing/apollo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workspaceId,
          name: form.name,
          filters,
          limit: form.limit ? Number(form.limit) : 25,
        }),
      });

      const payload = await response.json();
      if (!response.ok) {
        throw new Error(typeof payload.error === 'string' ? payload.error : 'Sourcing failed');
      }

      const data = payload.data;
      toast.success(
        `${data.inserted} added, ${data.duplicates} duplicates, ${data.suppressed} skipped, ${data.creditsUsed} credits`
      );
      setForm(EMPTY);
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setPending(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">Ideal customer profile</CardTitle>
        <CardDescription>
          Comma separated values for the list fields. Leave a field blank to skip it.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="name">Profile name</Label>
            <Input
              id="name"
              required
              value={form.name}
              onChange={set('name')}
              placeholder="Series A fintech, India"
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-2">
              <Label htmlFor="industries">Industries</Label>
              <Input
                id="industries"
                value={form.industries}
                onChange={set('industries')}
                placeholder="fintech, saas"
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="geos">Locations</Label>
              <Input
                id="geos"
                value={form.geos}
                onChange={set('geos')}
                placeholder="India, Singapore"
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="titles">Titles</Label>
              <Input
                id="titles"
                value={form.titles}
                onChange={set('titles')}
                placeholder="head of growth, vp marketing"
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="seniorities">Seniorities</Label>
              <Input
                id="seniorities"
                value={form.seniorities}
                onChange={set('seniorities')}
                placeholder="vp, director, head"
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="employeeMin">Employees (min)</Label>
              <Input
                id="employeeMin"
                type="number"
                min={0}
                value={form.employeeMin}
                onChange={set('employeeMin')}
                placeholder="11"
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="employeeMax">Employees (max)</Label>
              <Input
                id="employeeMax"
                type="number"
                min={0}
                value={form.employeeMax}
                onChange={set('employeeMax')}
                placeholder="200"
              />
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="excludeDomains">Exclude domains</Label>
            <Input
              id="excludeDomains"
              value={form.excludeDomains}
              onChange={set('excludeDomains')}
              placeholder="competitor.com, current-client.com"
            />
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="limit">Max results (1 to 100)</Label>
            <Input
              id="limit"
              type="number"
              min={1}
              max={100}
              value={form.limit}
              onChange={set('limit')}
            />
          </div>

          <Button type="submit" disabled={pending} className="mt-2">
            {pending ? 'Sourcing' : 'Run sourcing'}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
