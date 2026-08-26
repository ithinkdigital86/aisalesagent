'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';

import { activateIcp, saveIcp } from '@/app/actions/icp';
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
import { Textarea } from '@/components/ui/textarea';
import {
  SIZE_BANDS,
  bandFor,
  type IcpFiltersShape,
  type SizeBand,
} from '@/lib/cadence/icp-shape';

export type IcpRecord = {
  id: string;
  name: string;
  offer: string | null;
  active: boolean;
  updatedAt: string;
  triggerTypes: string[];
  filters: IcpFiltersShape;
};

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
  geos: '',
  sizeBand: '',
  excludeDomains: '',
  triggerTypes: '',
  offer: '',
};

type FormState = typeof EMPTY;

function formFor(profile: IcpRecord): FormState {
  return {
    name: profile.name,
    industries: (profile.filters.industries ?? []).join(', '),
    titles: (profile.filters.titles ?? []).join(', '),
    geos: (profile.filters.geos ?? []).join(', '),
    sizeBand: profile.filters.size_band ?? '',
    excludeDomains: (profile.filters.exclusions?.domains ?? []).join(', '),
    triggerTypes: profile.triggerTypes.join(', '),
    offer: profile.offer ?? '',
  };
}

export function IcpManager({
  workspaceId,
  profiles,
}: {
  workspaceId: string;
  profiles: IcpRecord[];
}) {
  const router = useRouter();
  const [editingId, setEditingId] = React.useState<string | null>(null);
  const [form, setForm] = React.useState<FormState>(EMPTY);
  const [pending, setPending] = React.useState(false);
  const [activating, setActivating] = React.useState<string | null>(null);

  const active = profiles.find((profile) => profile.active) ?? null;
  const editing = editingId ? profiles.find((profile) => profile.id === editingId) ?? null : null;

  function set<K extends keyof FormState>(key: K) {
    return (
      event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>
    ) => setForm((current) => ({ ...current, [key]: event.target.value }));
  }

  function startNew() {
    setEditingId(null);
    setForm(EMPTY);
  }

  function startEdit(profile: IcpRecord) {
    setEditingId(profile.id);
    setForm(formFor(profile));
  }

  async function submit(makeActive: boolean) {
    if (form.name.trim() === '') {
      toast.error('Give the profile a name');
      return;
    }

    setPending(true);
    try {
      const result = await saveIcp({
        workspaceId,
        id: editingId ?? undefined,
        name: form.name,
        industries: toList(form.industries),
        titles: toList(form.titles),
        geos: toList(form.geos),
        sizeBand: form.sizeBand === '' ? undefined : (form.sizeBand as SizeBand),
        excludeDomains: toList(form.excludeDomains),
        triggerTypes: toList(form.triggerTypes),
        offer: form.offer,
        makeActive,
      });

      if (!result.ok) {
        toast.error(result.error ?? 'Could not save the profile');
        return;
      }

      toast.success(
        editingId
          ? `Saved${makeActive ? ' and set as active' : ''}.`
          : `Profile created${makeActive ? ' and set as active' : ''}.`
      );
      setEditingId(result.id ?? null);
      router.refresh();
    } finally {
      setPending(false);
    }
  }

  async function onActivate(profile: IcpRecord) {
    setActivating(profile.id);
    try {
      const result = await activateIcp({ workspaceId, id: profile.id });
      if (!result.ok) {
        toast.error(result.error ?? 'Could not activate the profile');
        return;
      }
      toast.success(`${profile.name} is now the active profile.`);
      router.refresh();
    } finally {
      setActivating(null);
    }
  }

  return (
    <div className="flex flex-col gap-8">
      <div
        className={
          active
            ? 'rounded-lg border px-4 py-3 text-sm'
            : 'rounded-lg border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm'
        }
      >
        {active ? (
          <>
            <span className="font-medium text-foreground">Active profile: </span>
            <span className="text-muted-foreground">
              {active.name}. Every score the Qualifier writes is recorded against it.
            </span>
          </>
        ) : (
          <>
            <span className="font-medium text-foreground">No active profile. </span>
            <span className="text-muted-foreground">
              The Qualifier will refuse to score leads until one is set.
            </span>
          </>
        )}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-xl">
            {editing ? `Edit ${editing.name}` : 'New profile'}
          </CardTitle>
          <CardDescription>
            Comma separated values for the list fields. Leave a field blank to skip it.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void submit(false);
            }}
            className="flex flex-col gap-4"
          >
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
                <Label htmlFor="industries">Industry</Label>
                <Input
                  id="industries"
                  value={form.industries}
                  onChange={set('industries')}
                  placeholder="fintech, saas"
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="geos">Geography</Label>
                <Input
                  id="geos"
                  value={form.geos}
                  onChange={set('geos')}
                  placeholder="India, Singapore"
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="titles">Role titles</Label>
                <Input
                  id="titles"
                  value={form.titles}
                  onChange={set('titles')}
                  placeholder="head of growth, vp marketing"
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="sizeBand">Company size</Label>
                <select
                  id="sizeBand"
                  value={form.sizeBand}
                  onChange={set('sizeBand')}
                  className="h-9 rounded-md border border-input bg-transparent px-3 text-sm text-foreground shadow-xs outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]"
                >
                  <option value="">Any size</option>
                  {SIZE_BANDS.map((band) => (
                    <option key={band.value} value={band.value}>
                      {band.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="offer">Offer description</Label>
              <Textarea
                id="offer"
                rows={4}
                value={form.offer}
                onChange={set('offer')}
                placeholder="What you sell, who it is for, and the problem it removes. The Content Creator writes from this, so plain words beat marketing copy."
              />
              <p className="text-xs text-muted-foreground">
                At most 2,000 characters. {form.offer.length} used.
              </p>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="flex flex-col gap-2">
                <Label htmlFor="triggerTypes">Buying triggers</Label>
                <Input
                  id="triggerTypes"
                  value={form.triggerTypes}
                  onChange={set('triggerTypes')}
                  placeholder="hiring, funding, leadership_change"
                />
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
            </div>

            <div className="mt-2 flex flex-wrap gap-3">
              <Button type="submit" disabled={pending}>
                {pending ? 'Saving' : editing ? 'Save changes' : 'Create profile'}
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={pending}
                onClick={() => void submit(true)}
              >
                Save and set active
              </Button>
              {editing ? (
                <Button type="button" variant="ghost" disabled={pending} onClick={startNew}>
                  New profile instead
                </Button>
              ) : null}
            </div>
          </form>
        </CardContent>
      </Card>

      <section className="space-y-3">
        <h2 className="text-sm font-medium text-muted-foreground">Profiles</h2>
        {profiles.length === 0 ? (
          <div className="rounded-lg border border-dashed p-10 text-center text-sm text-muted-foreground">
            No profiles yet. The first one you create becomes the active one.
          </div>
        ) : (
          <ul className="divide-y rounded-lg border">
            {profiles.map((profile) => {
              const band = bandFor(profile.filters.size_band);
              return (
                <li key={profile.id} className="flex flex-wrap items-start gap-4 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{profile.name}</span>
                      {profile.active ? (
                        <span className="rounded-md bg-primary px-2 py-0.5 font-mono text-xs text-primary-foreground">
                          active
                        </span>
                      ) : null}
                    </div>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {[
                        (profile.filters.industries ?? []).join(', ') || 'any industry',
                        (profile.filters.titles ?? []).join(', ') || 'any title',
                        band?.label ?? 'any size',
                        (profile.filters.geos ?? []).join(', ') || 'anywhere',
                      ].join(' | ')}
                    </p>
                    {profile.offer ? (
                      <p className="mt-1 max-w-2xl truncate text-xs text-muted-foreground">
                        {profile.offer}
                      </p>
                    ) : (
                      <p className="mt-1 text-xs text-destructive">
                        No offer description, so the Content Creator writes without one.
                      </p>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Button size="sm" variant="ghost" onClick={() => startEdit(profile)}>
                      Edit
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={profile.active || activating !== null}
                      onClick={() => onActivate(profile)}
                    >
                      {activating === profile.id
                        ? 'Activating'
                        : profile.active
                          ? 'Active'
                          : 'Set active'}
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
