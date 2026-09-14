'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';

import { saveBusinessProfile } from '@/app/actions/business-profile';
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
import type { Guess, ProfileGuesses } from '@/lib/anthropic/prompts/profile-guesser';
import type {
  ListField as SuggestionListField,
  Suggestion,
  SuggestionField,
  UnsupportedSuggestion,
  WebsiteSuggestions,
} from '@/lib/anthropic/prompts/website-reader';
import {
  BUSINESS_PROFILE_LIMITS as LIMITS,
  type BusinessProfile,
  type FieldOrigin,
  type FieldOrigins,
} from '@/lib/cadence/business-profile';
import type { SiteReadFailureKind } from '@/lib/cadence/site-reader';

/** One item per line. Lines beat commas here: a service often contains one. */
function toLines(value: string): string[] {
  return value
    .split('\n')
    .map((item) => item.trim())
    .filter(Boolean);
}

/** "Outbound email" and "outbound email." are the same line. */
function lineKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

const EMPTY = {
  companyName: '',
  website: '',
  description: '',
  services: '',
  industriesServed: '',
  customerTypes: '',
  problemsSolved: '',
  differentiators: '',
  pricingModel: '',
  exclusions: '',
};

type FormState = typeof EMPTY;

function formFor(profile: BusinessProfile | null): FormState {
  if (!profile) return EMPTY;
  return {
    companyName: profile.companyName,
    website: profile.website ?? '',
    description: profile.description ?? '',
    services: profile.services.join('\n'),
    industriesServed: profile.industriesServed.join('\n'),
    customerTypes: profile.customerTypes.join('\n'),
    problemsSolved: profile.problemsSolved.join('\n'),
    differentiators: profile.differentiators.join('\n'),
    pricingModel: profile.pricingModel ?? '',
    exclusions: profile.exclusions.join('\n'),
  };
}

/** The fields either drafting path can suggest for, in form order. */
const SUGGESTION_FIELDS: SuggestionField[] = [
  'description',
  'services',
  'industriesServed',
  'customerTypes',
  'problemsSolved',
  'differentiators',
  'exclusions',
];

const FIELD_LABELS: Record<SuggestionField, string> = {
  description: 'description',
  services: 'services',
  industriesServed: 'industries served',
  customerTypes: 'kinds of customer',
  problemsSolved: 'problems solved',
  differentiators: 'what sets it apart',
  exclusions: 'who you will not take on',
};

/**
 * The ways a read can fail that the guesser is offered for: the site is
 * there but says nothing the reader can use, or it is not there at all.
 * A bad address or a blocked host is the owner's to fix, not to guess past.
 */
const GUESSABLE_FAILURES: ReadonlySet<SiteReadFailureKind> = new Set(['no_text', 'unreachable']);

/** What the route says about a page it read, without the text. */
interface PageSummary {
  url: string;
  title: string | null;
  chars: number;
}

interface SkippedPage {
  url: string;
  reason: string;
}

/** A successful read, as the panel shows it. */
interface SiteResult {
  domain: string;
  pages: PageSummary[];
  skipped: SkippedPage[];
  suggestions: WebsiteSuggestions;
  count: number;
  unsupported: UnsupportedSuggestion[];
  notes: string;
}

/** A failed read. The pages are whatever was read before it failed. */
interface SiteFailure {
  message: string;
  kind: SiteReadFailureKind | null;
  pages: PageSummary[];
  skipped: SkippedPage[];
}

/** The guesser's answer, as the panel shows it. Not a read: nothing was verified. */
interface GuessResult {
  companyName: string;
  domain: string | null;
  /** What the one look at the homepage recovered, so the owner can see how little there was. */
  scraps: { title: string | null; description: string | null; chars: number } | null;
  guesses: ProfileGuesses;
  count: number;
  notes: string;
}

export function BusinessProfileForm({
  workspaceId,
  profile,
}: {
  workspaceId: string;
  profile: BusinessProfile | null;
}) {
  const router = useRouter();
  const [form, setForm] = React.useState<FormState>(() => formFor(profile));
  const [pending, setPending] = React.useState(false);

  const [fetching, setFetching] = React.useState(false);
  const [guessing, setGuessing] = React.useState(false);
  const [site, setSite] = React.useState<SiteResult | null>(null);
  const [siteFailure, setSiteFailure] = React.useState<SiteFailure | null>(null);
  const [guess, setGuess] = React.useState<GuessResult | null>(null);
  /**
   * Where each field's text came from. Starts as the record says, changes
   * when a suggestion is accepted, and is saved with the form. The mark
   * stays through edits, the way a generated ICP stays generated: it says
   * where the text came from, not who last touched it. It goes only when
   * the field is emptied. Dismissing a panel does not clear it, because the
   * accepted text is still in the field.
   */
  const [origins, setOrigins] = React.useState<FieldOrigins>(() => profile?.fieldOrigins ?? {});

  const originOf = (field: SuggestionField): FieldOrigin => origins[field] ?? 'manual';

  function markOrigin(field: SuggestionField, origin: FieldOrigin) {
    setOrigins((current) => {
      // A field with a guess in it stays unverified even when a checked
      // suggestion is added to it: the guess is still there.
      if (current[field] === 'inferred' && origin === 'from_website') return current;
      return { ...current, [field]: origin };
    });
  }

  function clearOrigin(field: SuggestionField) {
    setOrigins((current) => {
      if (!(field in current)) return current;
      const next = { ...current };
      delete next[field];
      return next;
    });
  }

  function set<K extends keyof FormState>(key: K) {
    return (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      const value = event.target.value;
      setForm((current) => ({ ...current, [key]: value }));
      if (value.trim() === '' && SUGGESTION_FIELDS.includes(key as SuggestionField)) {
        clearOrigin(key as SuggestionField);
      }
    };
  }

  // The reader is an API route rather than a server action because reading
  // a site and running the model can take the best part of a minute, and
  // the route already turns each way it can fail into a message.
  async function onFetch() {
    if (form.website.trim() === '') {
      toast.error('Enter the website first');
      return;
    }
    setFetching(true);
    setSiteFailure(null);
    try {
      const response = await fetch('/api/business-profile/from-website', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ workspaceId, url: form.website, companyName: form.companyName }),
      });
      const payload = (await response.json().catch(() => null)) as {
        data?: SiteResult;
        error?: unknown;
        kind?: SiteReadFailureKind;
        pages?: PageSummary[];
        skipped?: SkippedPage[];
        salvage?: { detail: string } | null;
      } | null;

      if (!response.ok || !payload?.data) {
        const message =
          typeof payload?.error === 'string' ? payload.error : 'The website could not be read';
        setSite(null);
        setSiteFailure({
          message,
          kind: payload?.kind ?? null,
          pages: payload?.pages ?? [],
          skipped: payload?.skipped ?? [],
        });
        toast.error(message);
        return;
      }

      setSite(payload.data);
      setGuess(null);
      if (payload.data.count === 0) {
        toast.warning(`Read ${payload.data.pages.length} pages on ${payload.data.domain}, but they did not state anything the form asks for.`);
      } else {
        toast.success(
          `${payload.data.count} suggestions from ${payload.data.pages.length} pages on ${payload.data.domain}. Nothing is filled in until you accept it.`
        );
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'The website could not be read';
      setSiteFailure({ message, kind: null, pages: [], skipped: [] });
      toast.error(message);
    } finally {
      setFetching(false);
    }
  }

  /**
   * The second tier, offered only once the read has failed. It is a guess
   * from the name and domain, and the route and panel both say so; here the
   * only rule is that the name has to be there, because it is what the
   * guesses are made from.
   */
  async function onGuess() {
    if (form.companyName.trim() === '') {
      toast.error('Enter the company name first: the guesses are made from it');
      return;
    }
    setGuessing(true);
    try {
      const response = await fetch('/api/business-profile/from-name', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ workspaceId, companyName: form.companyName, url: form.website }),
      });
      const payload = (await response.json().catch(() => null)) as {
        data?: GuessResult;
        error?: unknown;
      } | null;

      if (!response.ok || !payload?.data) {
        const message = typeof payload?.error === 'string' ? payload.error : 'No guesses could be made';
        toast.error(message);
        return;
      }

      setGuess(payload.data);
      setSite(null);
      setSiteFailure(null);
      if (payload.data.count === 0) {
        toast.warning(`Nothing to guess from for "${payload.data.companyName}". Fill the form in by hand.`);
      } else {
        toast.warning(
          `${payload.data.count} guesses from the company name${payload.data.domain ? ` and ${payload.data.domain}` : ''}. They are not from the site. Accept each one only if it is right.`
        );
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'No guesses could be made');
    } finally {
      setGuessing(false);
    }
  }

  /**
   * Puts a field's website suggestions into the form without losing a word
   * the owner typed: an empty field is filled, a list gains the lines it
   * does not have, a written description gets the suggestion added below
   * it. Returns how many lines went in.
   */
  function applyField(field: SuggestionField, current: FormState): { next: FormState; added: number; cut: number } {
    if (!site) return { next: current, added: 0, cut: 0 };
    if (field === 'description') {
      const suggestion = site.suggestions.description;
      if (!suggestion) return { next: current, added: 0, cut: 0 };
      return applyLines(field, [suggestion.value], current);
    }
    return applyLines(
      field,
      site.suggestions[field].map((item) => item.value),
      current
    );
  }

  /** The one way text enters a field from either path. */
  function applyLines(
    field: SuggestionField,
    values: string[],
    current: FormState
  ): { next: FormState; added: number; cut: number } {
    if (field === 'description') {
      const value = values[0];
      if (!value) return { next: current, added: 0, cut: 0 };
      const existing = current.description.trim();
      if (existing.includes(value.trim())) return { next: current, added: 0, cut: 0 };
      const text = existing === '' ? value : `${current.description.trimEnd()}\n\n${value}`;
      return {
        next: { ...current, description: text.slice(0, LIMITS.description) },
        added: 1,
        cut: text.length > LIMITS.description ? 1 : 0,
      };
    }

    const existing = toLines(current[field]);
    const have = new Set(existing.map(lineKey));
    const additions: string[] = [];
    for (const value of values) {
      const key = lineKey(value);
      if (have.has(key)) continue;
      have.add(key);
      additions.push(value);
    }
    if (additions.length === 0) return { next: current, added: 0, cut: 0 };

    const room = Math.max(0, LIMITS.listItems - existing.length);
    const kept = additions.slice(0, room);
    return {
      next: { ...current, [field]: [...existing, ...kept].join('\n') },
      added: kept.length,
      cut: additions.length - kept.length,
    };
  }

  function acceptField(field: SuggestionField) {
    const { next, added, cut } = applyField(field, form);
    if (added === 0) {
      toast.message(`The ${FIELD_LABELS[field]} field already has everything the site suggested.`);
      return;
    }
    setForm(next);
    markOrigin(field, 'from_website');
    if (cut > 0) {
      toast.warning(
        `Added ${added} to ${FIELD_LABELS[field]}; ${cut} left out because the field holds at most ${LIMITS.listItems}.`
      );
    }
  }

  /**
   * One guess into one field. There is no "all of them" for guesses: each
   * is accepted on its own, and the field it goes into is marked inferred.
   */
  function acceptGuess(field: SuggestionField, item: Guess) {
    const { next, added, cut } = applyLines(field, [item.value], form);
    if (added === 0) {
      if (cut > 0) {
        toast.warning(`The ${FIELD_LABELS[field]} field already holds ${LIMITS.listItems}, the most it takes.`);
      } else {
        toast.message(`That is already in the ${FIELD_LABELS[field]} field.`);
      }
      return;
    }
    setForm(next);
    markOrigin(field, 'inferred');
  }

  /** Every website suggestion, but only into fields the owner has left empty. */
  function fillEmptyFields() {
    if (!site) return;
    let next = form;
    const filled: SuggestionField[] = [];
    for (const field of SUGGESTION_FIELDS) {
      if (next[field].trim() !== '') continue;
      const result = applyField(field, next);
      if (result.added > 0) {
        next = result.next;
        filled.push(field);
      }
    }
    if (filled.length === 0) {
      toast.message('No empty field had a suggestion for it. Accept them field by field instead.');
      return;
    }
    setForm(next);
    for (const field of filled) markOrigin(field, 'from_website');
    toast.success(`Filled ${filled.map((field) => FIELD_LABELS[field]).join(', ')} from the website.`);
  }

  function dismissSite() {
    setSite(null);
    setSiteFailure(null);
  }

  function dismissGuess() {
    setGuess(null);
  }

  /** Whether a guess is already in its field, so the button can say so. */
  function guessIsIn(field: SuggestionField, item: Guess): boolean {
    if (field === 'description') return form.description.trim().includes(item.value.trim());
    const key = lineKey(item.value);
    return toLines(form[field]).some((line) => lineKey(line) === key);
  }

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (form.companyName.trim() === '') {
      toast.error('Give the company a name');
      return;
    }

    setPending(true);
    try {
      const result = await saveBusinessProfile({
        workspaceId,
        companyName: form.companyName,
        website: form.website,
        description: form.description,
        services: toLines(form.services),
        industriesServed: toLines(form.industriesServed),
        customerTypes: toLines(form.customerTypes),
        problemsSolved: toLines(form.problemsSolved),
        differentiators: toLines(form.differentiators),
        pricingModel: form.pricingModel,
        exclusions: toLines(form.exclusions),
        fieldOrigins: origins,
      });
      if (!result.ok) {
        toast.error(result.error ?? 'Could not save the business profile');
        return;
      }
      const unverified = SUGGESTION_FIELDS.filter(
        (field) => origins[field] === 'inferred' && form[field].trim() !== ''
      );
      if (unverified.length > 0) {
        toast.success(
          `Business profile saved. ${unverified.map((field) => FIELD_LABELS[field]).join(', ')} ${unverified.length === 1 ? 'is' : 'are'} marked unverified until you check ${unverified.length === 1 ? 'it' : 'them'}.`
        );
      } else {
        toast.success('Business profile saved.');
      }
      router.refresh();
    } finally {
      setPending(false);
    }
  }

  const busy = fetching || guessing;
  const suggestionFor = (field: SuggestionListField) => site?.suggestions[field] ?? [];
  const guessesFor = (field: SuggestionListField) => guess?.guesses[field] ?? [];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">{profile ? 'Edit business profile' : 'Describe the business'}</CardTitle>
        <CardDescription>
          One item per line for the list fields. Plain words: this is read by the ICP strategist,
          which only knows what is written here, and a claim it cannot find here it will not make.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="flex flex-col gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-2">
              <Label htmlFor="companyName">Company name</Label>
              <Input
                id="companyName"
                required
                maxLength={LIMITS.companyName}
                value={form.companyName}
                onChange={set('companyName')}
                placeholder="iThink Digital"
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="website">Website</Label>
              <div className="flex gap-2">
                <Input
                  id="website"
                  maxLength={LIMITS.website}
                  value={form.website}
                  onChange={set('website')}
                  placeholder="https://example.com"
                  className="min-w-0 flex-1"
                />
                <Button
                  type="button"
                  variant="outline"
                  onClick={onFetch}
                  disabled={busy || pending || form.website.trim() === ''}
                  aria-label="Fetch the website and suggest entries for the fields below"
                >
                  {fetching ? 'Reading' : 'Fetch'}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Fetch reads the homepage and up to five more pages on the same site, and suggests
                entries for the fields below. Nothing is filled in until you accept it.
              </p>
            </div>
          </div>

          {fetching && (
            <div className="rounded-lg border px-4 py-3 text-sm text-muted-foreground" aria-live="polite">
              Reading the site. At most six pages and thirty seconds, then a moment to draft the
              entries.
            </div>
          )}

          {guessing && (
            <div className="rounded-lg border px-4 py-3 text-sm text-muted-foreground" aria-live="polite">
              Guessing from the company name and domain. One more look at the homepage for its
              title, then a moment to draft the guesses.
            </div>
          )}

          {siteFailure && !busy && (
            <SiteFailurePanel
              failure={siteFailure}
              canGuess={siteFailure.kind !== null && GUESSABLE_FAILURES.has(siteFailure.kind)}
              hasName={form.companyName.trim() !== ''}
              onGuess={onGuess}
              onDismiss={dismissSite}
            />
          )}

          {site && !busy && (
            <SitePanel site={site} onFillEmpty={fillEmptyFields} onDismiss={dismissSite} />
          )}

          {guess && !busy && <GuessPanel guess={guess} onDismiss={dismissGuess} />}

          <div className="flex flex-col gap-2">
            <FieldLabel htmlFor="description" origin={form.description.trim() !== '' ? originOf('description') : 'manual'}>
              What the business does
            </FieldLabel>
            <Textarea
              id="description"
              rows={4}
              maxLength={LIMITS.description}
              value={form.description}
              onChange={set('description')}
              placeholder="Two or three paragraphs, the way you would explain it to someone at a dinner. What you do, for whom, and how a customer's month changes once you are in."
            />
            <p className="text-xs text-muted-foreground">
              At most {LIMITS.description.toLocaleString()} characters. {form.description.length}{' '}
              used.
            </p>
            {site?.suggestions.description && (
              <SuggestionBox
                items={[site.suggestions.description]}
                action={form.description.trim() === '' ? 'Use' : 'Add below'}
                onUse={() => acceptField('description')}
              />
            )}
            {guess?.guesses.description && (
              <GuessBox
                items={[guess.guesses.description]}
                action={form.description.trim() === '' ? 'Accept' : 'Add below'}
                isIn={(item) => guessIsIn('description', item)}
                onAccept={(item) => acceptGuess('description', item)}
              />
            )}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <ListField
              id="services"
              label="Services"
              value={form.services}
              onChange={set('services')}
              placeholder={'Outbound email campaigns\nLinkedIn prospecting\nSales pipeline setup'}
              origin={originOf('services')}
              suggestions={suggestionFor('services')}
              onUse={() => acceptField('services')}
              guesses={guessesFor('services')}
              guessIsIn={(item) => guessIsIn('services', item)}
              onAcceptGuess={(item) => acceptGuess('services', item)}
            />
            <ListField
              id="industriesServed"
              label="Industries served"
              value={form.industriesServed}
              onChange={set('industriesServed')}
              placeholder={'B2B SaaS\nLogistics\nProfessional services'}
              origin={originOf('industriesServed')}
              suggestions={suggestionFor('industriesServed')}
              onUse={() => acceptField('industriesServed')}
              guesses={guessesFor('industriesServed')}
              guessIsIn={(item) => guessIsIn('industriesServed', item)}
              onAcceptGuess={(item) => acceptGuess('industriesServed', item)}
            />
            <ListField
              id="customerTypes"
              label="Kinds of customer"
              value={form.customerTypes}
              onChange={set('customerTypes')}
              placeholder={'Founder-led companies with no sales team\nIn-house marketing teams of two to five'}
              origin={originOf('customerTypes')}
              suggestions={suggestionFor('customerTypes')}
              onUse={() => acceptField('customerTypes')}
              guesses={guessesFor('customerTypes')}
              guessIsIn={(item) => guessIsIn('customerTypes', item)}
              onAcceptGuess={(item) => acceptGuess('customerTypes', item)}
            />
            <ListField
              id="problemsSolved"
              label="Problems solved"
              value={form.problemsSolved}
              onChange={set('problemsSolved')}
              placeholder={'Pipeline depends on referrals\nNo one owns outbound\nReply rates under 2 percent'}
              origin={originOf('problemsSolved')}
              suggestions={suggestionFor('problemsSolved')}
              onUse={() => acceptField('problemsSolved')}
              guesses={guessesFor('problemsSolved')}
              guessIsIn={(item) => guessIsIn('problemsSolved', item)}
              onAcceptGuess={(item) => acceptGuess('problemsSolved', item)}
            />
            <ListField
              id="differentiators"
              label="What sets it apart"
              value={form.differentiators}
              onChange={set('differentiators')}
              placeholder={'Every message is reviewed by a person before it is sent\nMonth to month, no retainer lock-in'}
              origin={originOf('differentiators')}
              suggestions={suggestionFor('differentiators')}
              onUse={() => acceptField('differentiators')}
              guesses={guessesFor('differentiators')}
              guessIsIn={(item) => guessIsIn('differentiators', item)}
              onAcceptGuess={(item) => acceptGuess('differentiators', item)}
            />
            <ListField
              id="exclusions"
              label="Who you will not take on"
              value={form.exclusions}
              onChange={set('exclusions')}
              placeholder={'Agencies\nCompanies under 10 people\nAnything consumer-facing'}
              origin={originOf('exclusions')}
              suggestions={suggestionFor('exclusions')}
              onUse={() => acceptField('exclusions')}
              guesses={guessesFor('exclusions')}
              guessIsIn={(item) => guessIsIn('exclusions', item)}
              onAcceptGuess={(item) => acceptGuess('exclusions', item)}
            />
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="pricingModel">Pricing model</Label>
            <Input
              id="pricingModel"
              maxLength={LIMITS.pricingModel}
              value={form.pricingModel}
              onChange={set('pricingModel')}
              placeholder="Monthly retainer from 1,500 USD, three-month minimum"
            />
          </div>

          <div className="mt-2 flex flex-wrap gap-3">
            <Button type="submit" disabled={pending}>
              {pending ? 'Saving' : profile ? 'Save changes' : 'Save business profile'}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

/**
 * A field label with its origin mark: "from website" for text accepted from
 * the reader, "unverified guess" for text accepted from the guesser. A
 * manual field has no mark. The mark says where the text came from, not
 * whether it has since been edited.
 */
function FieldLabel({
  htmlFor,
  origin,
  children,
}: {
  htmlFor: string;
  origin: FieldOrigin;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-2">
      <Label htmlFor={htmlFor}>{children}</Label>
      {origin === 'from_website' && (
        <span
          className="rounded bg-primary/10 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide text-primary"
          title="Holds text accepted from the website, each entry checked against a quote from it. Edit it freely; the mark only says where it came from."
        >
          from website
        </span>
      )}
      {origin === 'inferred' && (
        <span
          className="rounded border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide text-amber-700 dark:text-amber-400"
          title="Holds a guess made from the company name and domain, not read from the website. It is saved as unverified, and the ICP strategist is told so. Check it and correct it; the mark goes when the field is emptied."
        >
          unverified guess
        </span>
      )}
    </div>
  );
}

function ListField({
  id,
  label,
  value,
  onChange,
  placeholder,
  origin,
  suggestions,
  onUse,
  guesses,
  guessIsIn,
  onAcceptGuess,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (event: React.ChangeEvent<HTMLTextAreaElement>) => void;
  placeholder: string;
  origin: FieldOrigin;
  suggestions: Suggestion[];
  onUse: () => void;
  guesses: Guess[];
  guessIsIn: (item: Guess) => boolean;
  onAcceptGuess: (item: Guess) => void;
}) {
  const count = toLines(value).length;
  return (
    <div className="flex flex-col gap-2">
      <FieldLabel htmlFor={id} origin={count > 0 ? origin : 'manual'}>
        {label}
      </FieldLabel>
      <Textarea id={id} rows={4} value={value} onChange={onChange} placeholder={placeholder} />
      <p className="text-xs text-muted-foreground">
        One per line, at most {LIMITS.listItems}. {count} listed.
      </p>
      {suggestions.length > 0 && (
        <SuggestionBox
          items={suggestions}
          action={count === 0 ? 'Use' : `Add ${suggestions.length === 1 ? 'it' : 'these'}`}
          onUse={onUse}
        />
      )}
      {guesses.length > 0 && (
        <GuessBox items={guesses} action="Accept" isIn={guessIsIn} onAccept={onAcceptGuess} />
      )}
    </div>
  );
}

/**
 * What the site suggested for one field, with the quote each entry rests on
 * one click away. The button never replaces typed text; the label says
 * whether it fills or adds.
 */
function SuggestionBox({
  items,
  action,
  onUse,
}: {
  items: Suggestion[];
  action: string;
  onUse: () => void;
}) {
  return (
    <div className="rounded-md border border-dashed bg-muted/30 p-3 text-sm">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
          From the website
        </span>
        <Button type="button" size="sm" variant="secondary" onClick={onUse}>
          {action}
        </Button>
      </div>
      <ul className="flex flex-col gap-2">
        {items.map((item, index) => (
          <li key={`${index}-${item.value}`}>
            <p className="whitespace-pre-wrap">{item.value}</p>
            <details className="mt-0.5">
              <summary className="cursor-pointer text-xs text-muted-foreground">Quote from the site</summary>
              <blockquote className="mt-1 border-l-2 pl-2 text-xs italic text-muted-foreground">
                {item.evidence}
              </blockquote>
            </details>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * What the guesser proposed for one field. Unlike the website box there is
 * no field-level button: each guess has its own, because each is a separate
 * claim the owner has to vouch for. The reasoning is shown in place of a
 * quote, and labelled as reasoning, because that is all there is.
 */
function GuessBox({
  items,
  action,
  isIn,
  onAccept,
}: {
  items: Guess[];
  action: string;
  isIn: (item: Guess) => boolean;
  onAccept: (item: Guess) => void;
}) {
  return (
    <div className="rounded-md border border-dashed border-amber-500/50 bg-amber-500/5 p-3 text-sm">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="font-mono text-[10px] uppercase tracking-widest text-amber-700 dark:text-amber-400">
          Guessed, not from the site
        </span>
      </div>
      <ul className="flex flex-col gap-2">
        {items.map((item, index) => {
          const accepted = isIn(item);
          return (
            <li key={`${index}-${item.value}`} className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <p className="whitespace-pre-wrap">{item.value}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  <span className="font-medium">Why it guessed this:</span>{' '}
                  {item.why.trim() !== '' ? item.why : 'no reason given'}
                </p>
              </div>
              <Button
                type="button"
                size="sm"
                variant={accepted ? 'ghost' : 'secondary'}
                disabled={accepted}
                onClick={() => onAccept(item)}
                aria-label={accepted ? `Already in the field: ${item.value}` : `${action} the guess: ${item.value}`}
              >
                {accepted ? 'Accepted' : action}
              </Button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function PageList({ pages, skipped }: { pages: PageSummary[]; skipped: SkippedPage[] }) {
  if (pages.length === 0 && skipped.length === 0) return null;
  return (
    <ul className="flex flex-col gap-1 text-xs">
      {pages.map((page) => (
        <li key={page.url} className="flex flex-wrap items-baseline gap-x-2">
          <a
            href={page.url}
            target="_blank"
            rel="noreferrer noopener"
            className="break-all underline underline-offset-2"
          >
            {page.title ?? page.url}
          </a>
          {page.title && <span className="break-all text-muted-foreground">{page.url}</span>}
          <span className="text-muted-foreground">{page.chars.toLocaleString()} characters</span>
        </li>
      ))}
      {skipped.map((page) => (
        <li key={page.url} className="flex flex-wrap items-baseline gap-x-2 text-muted-foreground">
          <span className="break-all line-through">{page.url}</span>
          <span>skipped: {page.reason}</span>
        </li>
      ))}
    </ul>
  );
}

/** What was read and what came of it. The panel that makes an extraction traceable. */
function SitePanel({
  site,
  onFillEmpty,
  onDismiss,
}: {
  site: SiteResult;
  onFillEmpty: () => void;
  onDismiss: () => void;
}) {
  return (
    <div className="flex flex-col gap-3 rounded-lg border px-4 py-3 text-sm" aria-live="polite">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p>
          <span className="font-medium">Read {site.pages.length} {site.pages.length === 1 ? 'page' : 'pages'} on {site.domain}.</span>{' '}
          {site.count === 0
            ? 'They did not state anything the form asks for.'
            : `${site.count} ${site.count === 1 ? 'suggestion' : 'suggestions'}, shown beside the fields below. Accept them one field at a time, or fill only the fields that are still empty.`}
        </p>
        <div className="flex gap-2">
          {site.count > 0 && (
            <Button type="button" size="sm" onClick={onFillEmpty}>
              Fill the empty fields
            </Button>
          )}
          <Button type="button" size="sm" variant="ghost" onClick={onDismiss}>
            Dismiss
          </Button>
        </div>
      </div>

      <PageList pages={site.pages} skipped={site.skipped} />

      {site.notes.trim() !== '' && (
        <p className="text-xs text-muted-foreground">
          <span className="font-medium text-foreground">What the site did not say:</span> {site.notes}
        </p>
      )}

      {site.unsupported.length > 0 && (
        <details className="text-xs text-muted-foreground">
          <summary className="cursor-pointer">
            {site.unsupported.length} {site.unsupported.length === 1 ? 'suggestion was' : 'suggestions were'} dropped
            because the quote given for {site.unsupported.length === 1 ? 'it' : 'them'} is not in the page text.
          </summary>
          <ul className="mt-1 flex flex-col gap-1">
            {site.unsupported.map((item, index) => (
              <li key={`${item.field}-${index}`}>
                <span className="font-mono">{FIELD_LABELS[item.field]}</span>: {item.value}
                {item.evidence && <span className="italic"> (quoted: &ldquo;{item.evidence}&rdquo;)</span>}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

/**
 * What the guesser proposed and what it had to go on. It says, in as many
 * words, that these are guesses from the name and not from the site, because
 * the field-level boxes below it look a lot like the website's ones and the
 * difference is the whole point.
 */
function GuessPanel({ guess, onDismiss }: { guess: GuessResult; onDismiss: () => void }) {
  const hadScraps = guess.scraps && (guess.scraps.title || guess.scraps.description || guess.scraps.chars > 0);
  return (
    <div
      className="flex flex-col gap-3 rounded-lg border border-amber-500/40 bg-amber-500/5 px-4 py-3 text-sm"
      aria-live="polite"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p>
          <span className="font-medium">
            {guess.count === 0
              ? `No guesses for "${guess.companyName}".`
              : `${guess.count} ${guess.count === 1 ? 'guess' : 'guesses'} from the company name${guess.domain ? ` and ${guess.domain}` : ''}.`}
          </span>{' '}
          {guess.count === 0
            ? 'There was not enough to go on. Fill the form in by hand.'
            : 'These are guesses, not facts about the business. They were made from the name and the domain, because the website could not be read; nothing here comes from the site. Accept a guess only if it is right, one at a time, and correct anything that is close but wrong. Every field that takes one is marked unverified until you check it.'}
        </p>
        <Button type="button" size="sm" variant="ghost" onClick={onDismiss}>
          Dismiss
        </Button>
      </div>

      <p className="text-xs text-muted-foreground">
        <span className="font-medium text-foreground">What it had to go on:</span> the name
        &ldquo;{guess.companyName}&rdquo;
        {guess.domain ? `, the domain ${guess.domain}` : ''}
        {hadScraps && guess.scraps ? (
          <>
            , and from one more look at the homepage:{' '}
            {guess.scraps.title ? `the title “${guess.scraps.title}”` : ''}
            {guess.scraps.title && guess.scraps.description ? ' and ' : ''}
            {guess.scraps.description ? `the description “${guess.scraps.description}”` : ''}
            {guess.scraps.chars > 0 ? ` (${guess.scraps.chars.toLocaleString()} characters of text)` : ''}
          </>
        ) : (
          ', and nothing from the site itself'
        )}
        .
      </p>

      {guess.notes.trim() !== '' && (
        <p className="text-xs text-muted-foreground">
          <span className="font-medium text-foreground">What to check first:</span> {guess.notes}
        </p>
      )}
    </div>
  );
}

function SiteFailurePanel({
  failure,
  canGuess,
  hasName,
  onGuess,
  onDismiss,
}: {
  failure: SiteFailure;
  canGuess: boolean;
  hasName: boolean;
  onGuess: () => void;
  onDismiss: () => void;
}) {
  return (
    <div
      className="flex flex-col gap-2 rounded-lg border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm"
      role="alert"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p>
          <span className="font-medium">The website could not be read.</span> {failure.message} Nothing was
          filled in.
        </p>
        <Button type="button" size="sm" variant="ghost" onClick={onDismiss}>
          Dismiss
        </Button>
      </div>
      {failure.pages.length > 0 && (
        <p className="text-xs text-muted-foreground">Pages read before it failed:</p>
      )}
      <PageList pages={failure.pages} skipped={failure.skipped} />

      {canGuess && (
        <div className="mt-1 flex flex-col gap-2 border-t border-destructive/20 pt-3">
          <p className="text-xs text-muted-foreground">
            The form can be started another way: a model guesses the entries from the company name
            and domain. That is a guess, not a read of the site. Each guess has to be accepted by
            hand, and every field that takes one is saved as unverified.
          </p>
          <div>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={onGuess}
              disabled={!hasName}
              title={hasName ? undefined : 'Enter the company name first: the guesses are made from it'}
            >
              Suggest from the company name and domain instead
            </Button>
          </div>
          {!hasName && (
            <p className="text-xs text-muted-foreground">Enter the company name first: the guesses are made from it.</p>
          )}
        </div>
      )}
    </div>
  );
}
