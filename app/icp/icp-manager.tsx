'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';

import { activateIcp, dismissIcp, saveIcp } from '@/app/actions/icp';
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
import type { IcpOrigin } from '@/lib/cadence/icp';
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
  /** Written by a person, or proposed by the strategist. Survives editing. */
  origin: IcpOrigin;
  generationId: string | null;
  painPoints: string[];
  exclusions: string[];
  rationale: string | null;
};

/** The most recent strategist run, so the page can say what it recommended. */
export type IcpGeneration = {
  id: string;
  createdAt: string;
  recommendedId: string | null;
  recommendationReason: string | null;
};

/** What the page knows about the business profile without loading all of it. */
export type BusinessProfileSummary = {
  companyName: string;
  /** Fields still blank, shown as a nudge before a run is spent on them. */
  missing: string[];
  /**
   * Fields holding guesses from the company name that the owner has not
   * checked. Shown so a batch of profiles built on guesses is not mistaken
   * for one built on research.
   */
  unverified: string[];
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
  painPoints: '',
  exclusions: '',
  rationale: '',
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
    painPoints: profile.painPoints.join(', '),
    exclusions: profile.exclusions.join(', '),
    rationale: profile.rationale ?? '',
  };
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

export function IcpManager({
  workspaceId,
  profiles,
  generation,
  businessProfile,
}: {
  workspaceId: string;
  profiles: IcpRecord[];
  generation: IcpGeneration | null;
  businessProfile: BusinessProfileSummary | null;
}) {
  const router = useRouter();
  const [editingId, setEditingId] = React.useState<string | null>(null);
  const [form, setForm] = React.useState<FormState>(EMPTY);
  const [pending, setPending] = React.useState(false);
  const [activating, setActivating] = React.useState<string | null>(null);
  const [dismissing, setDismissing] = React.useState<string | null>(null);
  const [generating, setGenerating] = React.useState(false);

  const active = profiles.find((profile) => profile.active) ?? null;
  const editing = editingId ? profiles.find((profile) => profile.id === editingId) ?? null : null;
  const recommended = generation?.recommendedId
    ? profiles.find((profile) => profile.id === generation.recommendedId) ?? null
    : null;

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
        painPoints: toList(form.painPoints),
        exclusions: toList(form.exclusions),
        rationale: form.rationale,
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

  async function onDismiss(profile: IcpRecord) {
    setDismissing(profile.id);
    try {
      const result = await dismissIcp({ workspaceId, id: profile.id });
      if (!result.ok) {
        toast.error(result.error ?? 'Could not dismiss the profile');
        return;
      }
      if (editingId === profile.id) startNew();
      toast.success(`${profile.name} dismissed.`);
      router.refresh();
    } finally {
      setDismissing(null);
    }
  }

  // The strategist is an API route rather than a server action because a run
  // is a model call that can take a while, and the route already knows how to
  // turn a failed run into a status the page can show.
  async function onGenerate() {
    setGenerating(true);
    try {
      const response = await fetch('/api/agents/icp-strategist', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ workspaceId }),
      });
      const payload = (await response.json().catch(() => null)) as {
        data?: { count: number; recommendedId: string | null; droppedProfiles: string[] };
        error?: unknown;
        salvage?: { detail: string } | null;
      } | null;

      if (!response.ok || !payload?.data) {
        const error = payload?.error;
        toast.error(typeof error === 'string' ? error : 'The strategist run failed');
        return;
      }

      const { count, droppedProfiles } = payload.data;
      if (droppedProfiles.length > 0) {
        toast.warning(
          `${count} profiles proposed. ${droppedProfiles.length} more could not be read and were left out.`
        );
      } else {
        toast.success(`${count} profiles proposed. None is active until you choose one.`);
      }
      router.refresh();
    } finally {
      setGenerating(false);
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
          <CardTitle className="text-xl">Suggested profiles</CardTitle>
          <CardDescription>
            The strategist reads the business profile and proposes ten customer profiles with one
            recommended. They arrive inactive. Activate the one you want, edit any of them, dismiss
            the rest.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4 text-sm">
          {businessProfile ? (
            <>
              <p className="text-muted-foreground">
                Reading the profile for{' '}
                <span className="font-medium text-foreground">{businessProfile.companyName}</span>.{' '}
                {businessProfile.missing.length > 0 ? (
                  <>
                    Still blank: {businessProfile.missing.join(', ')}. The strategist will guess
                    around those, so{' '}
                    <Link href="/icp/business" className="underline underline-offset-4">
                      filling them in first
                    </Link>{' '}
                    gets better suggestions.
                  </>
                ) : (
                  <Link href="/icp/business" className="underline underline-offset-4">
                    Edit the business profile
                  </Link>
                )}
              </p>
              {businessProfile.unverified.length > 0 && (
                <p className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-amber-900 dark:text-amber-200">
                  <span className="font-medium">Unverified: {businessProfile.unverified.join(', ')}.</span>{' '}
                  These hold guesses made from the company name and domain, not read from the
                  website. The strategist is told they are guesses, and profiles built on them are
                  provisional.{' '}
                  <Link href="/icp/business" className="underline underline-offset-4">
                    Check them
                  </Link>{' '}
                  before spending a run.
                </p>
              )}
              {generation ? (
                <p className="text-muted-foreground">
                  Last run {formatDate(generation.createdAt)}.{' '}
                  {recommended ? (
                    <>
                      Recommended <span className="font-medium text-foreground">{recommended.name}</span>
                      {generation.recommendationReason ? `: ${generation.recommendationReason}` : '.'}
                    </>
                  ) : (
                    'No recommendation was recorded.'
                  )}
                </p>
              ) : null}
              <div>
                <Button type="button" disabled={generating} onClick={() => void onGenerate()}>
                  {generating
                    ? 'Proposing profiles'
                    : generation
                      ? 'Propose ten more'
                      : 'Propose ten profiles'}
                </Button>
              </div>
            </>
          ) : (
            <p className="text-muted-foreground">
              No business profile yet. The strategist has nothing to read, so{' '}
              <Link href="/icp/business" className="underline underline-offset-4">
                describe the business
              </Link>{' '}
              first.
            </p>
          )}
        </CardContent>
      </Card>

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
              <div className="flex flex-col gap-2">
                <Label htmlFor="painPoints">Pain points</Label>
                <Input
                  id="painPoints"
                  value={form.painPoints}
                  onChange={set('painPoints')}
                  placeholder="leads go cold in the CRM, no one owns outbound"
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="exclusions">Who not to pursue</Label>
                <Input
                  id="exclusions"
                  value={form.exclusions}
                  onChange={set('exclusions')}
                  placeholder="agencies, pre-revenue startups"
                />
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="rationale">Why this segment</Label>
              <Textarea
                id="rationale"
                rows={2}
                value={form.rationale}
                onChange={set('rationale')}
                placeholder="Why this segment fits the business. Shown here, never sent."
              />
              <p className="text-xs text-muted-foreground">
                At most 1,000 characters. {form.rationale.length} used.
              </p>
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
              const isRecommended = generation?.recommendedId === profile.id;
              return (
                <li key={profile.id} className="flex flex-wrap items-start gap-4 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{profile.name}</span>
                      {profile.active ? (
                        <span className="rounded-md bg-primary px-2 py-0.5 font-mono text-xs text-primary-foreground">
                          active
                        </span>
                      ) : null}
                      {profile.origin === 'generated' ? (
                        <span className="rounded-md border px-2 py-0.5 font-mono text-xs text-muted-foreground">
                          suggested
                        </span>
                      ) : null}
                      {isRecommended ? (
                        <span className="rounded-md border border-primary/40 px-2 py-0.5 font-mono text-xs text-primary">
                          recommended
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
                    {profile.rationale ? (
                      <p className="mt-1 max-w-2xl text-xs text-muted-foreground">
                        {profile.rationale}
                      </p>
                    ) : null}
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Button size="sm" variant="ghost" onClick={() => startEdit(profile)}>
                      Edit
                    </Button>
                    {profile.origin === 'generated' && !profile.active ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={dismissing !== null}
                        onClick={() => void onDismiss(profile)}
                      >
                        {dismissing === profile.id ? 'Dismissing' : 'Dismiss'}
                      </Button>
                    ) : null}
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={profile.active || activating !== null}
                      onClick={() => void onActivate(profile)}
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
