// lib/cadence/site-reader.ts
//
// Reads a company's public website so the business profile can be drafted
// from it: the homepage, then the handful of same-domain pages whose link
// suggests they describe the company (about, services, products, pricing,
// customers, industries). Scripts, styles and navigation are stripped so what
// reaches the model is the page's own words and nothing else.
//
// Hard caps, not preferences: at most SITE_READER_LIMITS.pages pages and
// SITE_READER_LIMITS.budgetMs of wall clock for the whole read, however slow
// the site. The homepage failing fails the read; a sub-page failing is
// recorded and skipped, so the owner can see exactly which pages the
// suggestions rest on.
//
// The URL is typed by a user and fetched from our server, so hosts that
// resolve to private or loopback addresses are refused, and redirects are
// followed by hand so each hop gets the same check.
//
// Plain node: fetch, URL and dns only. No Next, no Supabase, no DOM library,
// so the tests can load it straight under node --test.

import { lookup as dnsLookup } from 'node:dns/promises';

export const SITE_READER_LIMITS = {
  /** Homepage included. */
  pages: 6,
  /** For the whole read, every page together. */
  budgetMs: 30_000,
  /** One page never gets more than this, so one slow page cannot eat the budget. */
  pageMs: 12_000,
  /** Redirect hops followed for one page. */
  redirects: 5,
  /** Raw HTML read per page. Anything past this is not downloaded. */
  htmlBytes: 400_000,
  /** Text kept per page after stripping. */
  pageChars: 12_000,
  /** Text kept across every page. */
  totalChars: 40_000,
  /**
   * A page with less readable text than this is treated as having none. It
   * is what a JavaScript-rendered shell looks like once the scripts are gone.
   */
  minChars: 200,
  /**
   * The second look at a site the read gave up on: one fetch of the homepage
   * for its title and meta description, which a JavaScript shell usually
   * still carries in its head. Short, because the read has already failed
   * once and the owner is waiting.
   */
  scrapsMs: 8_000,
  /** Text kept from that one page, on top of the title and description. */
  scrapsChars: 1_500,
} as const;

/** One page that was read: what the model sees, and what the owner is shown. */
export interface ReadPage {
  url: string;
  title: string | null;
  text: string;
}

/** A page that was picked but not read, and why. */
export interface SkippedPage {
  url: string;
  reason: string;
}

export type SiteReadFailureKind =
  /** Not something that can be fetched: no host, wrong scheme. */
  | 'invalid_url'
  /** Resolves to a private, loopback or link-local address. */
  | 'blocked_host'
  /** DNS or connection failure. */
  | 'unreachable'
  /** The server answered with a non-2xx status. */
  | 'http_error'
  /** The server answered with something that is not a web page. */
  | 'not_html'
  /** A page came back, but with almost no text once scripts were removed. */
  | 'no_text'
  /** The homepage did not answer inside the budget. */
  | 'timeout';

export type SiteReadResult =
  | {
      ok: true;
      /** The host the pages were read from, after redirects and minus www. */
      domain: string;
      pages: ReadPage[];
      skipped: SkippedPage[];
      elapsedMs: number;
    }
  | {
      ok: false;
      kind: SiteReadFailureKind;
      /** Plain words, safe to show the owner. */
      detail: string;
      pages: ReadPage[];
      skipped: SkippedPage[];
      elapsedMs: number;
    };

/** Injection points for the tests. Production callers pass nothing. */
export interface SiteReaderDeps {
  fetch?: typeof fetch;
  /** Every address a host resolves to. Throws when it does not resolve. */
  lookup?: (hostname: string) => Promise<string[]>;
  now?: () => number;
  budgetMs?: number;
}

// ---------------------------------------------------------------
// URLs and hosts
// ---------------------------------------------------------------

/**
 * The URL as typed, made fetchable: a bare domain gets https, the fragment
 * goes, and anything that is not http(s) is refused.
 */
export function normaliseSiteUrl(input: string): URL | null {
  const trimmed = input.trim();
  if (trimmed === '') return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  if (url.hostname === '' || !url.hostname.includes('.')) return null;
  url.hash = '';
  return url;
}

/** Host for display and comparison: lower-cased, without a leading www. */
export function siteDomain(url: URL): string {
  return url.hostname.toLowerCase().replace(/^www\./, '');
}

export function sameSite(a: URL, b: URL): boolean {
  return siteDomain(a) === siteDomain(b);
}

/** Literal hostnames and addresses that are never fetched. */
export function isBlockedHostname(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, '');
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) return true;
  if (host.endsWith('.internal') || host === 'metadata.google.internal') return true;
  return isPrivateAddress(host.replace(/^\[|\]$/g, ''));
}

/** True for loopback, private, link-local and unspecified addresses, v4 or v6. */
export function isPrivateAddress(address: string): boolean {
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(address);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    if (a === 10 || a === 127 || a === 0) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
    return false;
  }
  if (address.includes(':')) {
    const v6 = address.toLowerCase();
    if (v6 === '::1' || v6 === '::') return true;
    if (/^f[cd][0-9a-f]{2}:/.test(v6)) return true; // fc00::/7
    if (/^fe[89ab][0-9a-f]:/.test(v6)) return true; // fe80::/10
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(v6);
    if (mapped) return isPrivateAddress(mapped[1]);
  }
  return false;
}

async function defaultLookup(hostname: string): Promise<string[]> {
  const records = await dnsLookup(hostname, { all: true });
  return records.map((record) => record.address);
}

// ---------------------------------------------------------------
// HTML to text
// ---------------------------------------------------------------

/**
 * Elements whose contents are never the page's own words, in two kinds.
 * Raw-text elements hold code, not markup, so they are cut from open tag to
 * the first close tag. Structural ones nest (a nav inside a header inside a
 * nav), so they are cut by counting depth. Navigation, headers and footers
 * go with the scripts: the same menu on six pages is noise, and what the
 * company says about itself is in the body.
 */
const RAW_TEXT_ELEMENTS = ['script', 'style', 'noscript', 'template'];
const STRUCTURAL_ELEMENTS = new Set([
  'svg',
  'canvas',
  'iframe',
  'object',
  'nav',
  'header',
  'footer',
  'aside',
  'form',
  'button',
  'select',
]);

/** Tags that end a line of text when they close (or, for br, appear). */
const BLOCK_TAGS =
  'p|div|section|article|main|li|ul|ol|h[1-6]|tr|td|th|table|blockquote|pre|dd|dt|dl|figure|figcaption|address|details|summary';

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  ndash: '–',
  mdash: '—',
  hellip: '…',
  copy: '©',
  reg: '®',
  trade: '™',
  lsquo: '‘',
  rsquo: '’',
  ldquo: '“',
  rdquo: '”',
  bull: '•',
  middot: '·',
};

export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, entity: string) => {
    const lower = entity.toLowerCase();
    if (lower.startsWith('#x')) {
      const code = Number.parseInt(lower.slice(2), 16);
      return Number.isFinite(code) ? safeFromCodePoint(code, whole) : whole;
    }
    if (lower.startsWith('#')) {
      const code = Number.parseInt(lower.slice(1), 10);
      return Number.isFinite(code) ? safeFromCodePoint(code, whole) : whole;
    }
    return NAMED_ENTITIES[lower] ?? whole;
  });
}

function safeFromCodePoint(code: number, fallback: string): string {
  try {
    return String.fromCodePoint(code);
  } catch {
    return fallback;
  }
}

/** Cuts the raw-text elements, then the structural ones, contents and all. */
function dropElements(html: string): string {
  const raw = new RegExp(`<(${RAW_TEXT_ELEMENTS.join('|')})\\b[^>]*>[\\s\\S]*?<\\/\\1\\s*>`, 'gi');
  return dropStructural(html.replace(raw, ' '));
}

/**
 * Removes every STRUCTURAL_ELEMENTS element with everything inside it, by
 * depth, so nested ones come out whole. An element left open at the end of
 * the page is treated as closed there rather than swallowing the rest of the
 * page: a stray nav in the text beats a page with no text.
 */
function dropStructural(html: string): string {
  const tag = /<(\/?)([a-zA-Z][a-zA-Z0-9-]*)\b[^>]*?(\/?)>/g;
  let out = '';
  let depth = 0;
  let emittedTo = 0;
  /** Where the element currently being dropped began. */
  let openedAt = 0;

  for (const match of html.matchAll(tag)) {
    const name = match[2].toLowerCase();
    if (!STRUCTURAL_ELEMENTS.has(name)) continue;
    const closing = match[1] === '/';
    const selfClosing = match[3] === '/';
    const end = match.index + match[0].length;

    if (!closing && !selfClosing) {
      if (depth === 0) {
        out += html.slice(emittedTo, match.index);
        openedAt = match.index;
      }
      depth += 1;
    } else if (closing && depth > 0) {
      depth -= 1;
      if (depth === 0) emittedTo = end;
    }
  }

  return out + html.slice(depth === 0 ? emittedTo : openedAt);
}

/**
 * The page's readable text, one line per block, and its title. Whitespace is
 * collapsed and blank runs squeezed to one, so a page of nested divs does not
 * arrive as a page of newlines.
 */
export function htmlToText(html: string): { title: string | null; text: string } {
  const titleMatch = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  const title = titleMatch ? decodeEntities(titleMatch[1]).replace(/\s+/g, ' ').trim() || null : null;

  const body = html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, ' ');

  const stripped = dropElements(body)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(new RegExp(`<\\/(?:${BLOCK_TAGS})\\s*>`, 'gi'), '\n')
    .replace(new RegExp(`<(?:${BLOCK_TAGS})\\b[^>]*>`, 'gi'), '\n')
    .replace(/<[^>]+>/g, ' ');

  const text = decodeEntities(stripped)
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter((line) => line !== '')
    .join('\n');

  return { title, text };
}

/**
 * Text a JavaScript shell leaves behind once the scripts are gone: a title,
 * "loading", a cookie notice. Anything under minChars counts as nothing.
 */
export function hasReadableText(text: string): boolean {
  return text.length >= SITE_READER_LIMITS.minChars;
}

/**
 * The page's own one-line summary, from the head: the meta description, or
 * failing that the Open Graph one. Attribute order varies, so each meta tag
 * is read for both attributes rather than matched as a pattern.
 */
export function extractMetaDescription(html: string): string | null {
  const head = /<head[^>]*>([\s\S]*?)<\/head>/i.exec(html)?.[1] ?? html;
  let fallback: string | null = null;
  for (const tag of head.matchAll(/<meta\b[^>]*>/gi)) {
    const attrs = tag[0];
    const name = (/\b(?:name|property)\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(attrs) ?? [])
      .slice(1)
      .find((v) => v !== undefined)
      ?.toLowerCase();
    if (name !== 'description' && name !== 'og:description' && name !== 'twitter:description') continue;
    const content = (/\bcontent\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(attrs) ?? [])
      .slice(1)
      .find((v) => v !== undefined);
    if (content === undefined) continue;
    const text = decodeEntities(content).replace(/\s+/g, ' ').trim();
    if (text === '') continue;
    if (name === 'description') return text;
    fallback ??= text;
  }
  return fallback;
}

// ---------------------------------------------------------------
// Which links to follow
// ---------------------------------------------------------------

/**
 * What a link has to look like, in its path or its text, to be worth a page
 * of the budget. Ordered by how much a business profile gains from the page,
 * because that is the order slots are handed out in.
 */
export const PAGE_TOPICS = [
  {
    key: 'about',
    path: /\b(about|who-we-are|who_we_are|our-story|company|overview)\b/,
    text: /\b(about|who we are|our story|company|overview)\b/,
  },
  {
    key: 'services',
    path: /\b(services?|what-we-do|what_we_do|solutions?|offerings?|capabilities|expertise)\b/,
    text: /\b(services?|what we do|solutions?|offerings?|capabilities|expertise)\b/,
  },
  {
    key: 'products',
    path: /\b(products?|platform|features?)\b/,
    text: /\b(products?|platform|features?)\b/,
  },
  {
    key: 'pricing',
    path: /\b(pricing|prices?|plans?|packages?)\b/,
    text: /\b(pricing|prices?|plans?|packages?)\b/,
  },
  {
    key: 'customers',
    path: /\b(customers?|clients?|case-stud(?:y|ies)|case_stud(?:y|ies)|success-stories|testimonials?|portfolio|our-work|work)\b/,
    text: /\b(customers?|clients?|case stud(?:y|ies)|success stories|testimonials?|portfolio|our work|work)\b/,
  },
  {
    key: 'industries',
    path: /\b(industr(?:y|ies)|sectors?|verticals?|who-we-serve|who_we_serve|markets?)\b/,
    text: /\b(industr(?:y|ies)|sectors?|verticals?|who we serve|markets?)\b/,
  },
] as const;

export type PageTopic = (typeof PAGE_TOPICS)[number]['key'];

/** Links to things that are not pages. */
const NON_PAGE_PATH = /\.(pdf|docx?|xlsx?|pptx?|zip|png|jpe?g|gif|svg|webp|mp4|mp3|ics|xml|json|css|js)$/i;

export interface CandidateLink {
  url: string;
  topic: PageTopic;
  text: string;
}

/** The same page by two spellings should be one candidate. */
function pageKey(url: URL): string {
  const path = url.pathname.replace(/\/+$/, '') || '/';
  return `${siteDomain(url)}${path.toLowerCase()}${url.search}`;
}

/** The topic a link's path, then its text, matches. Null when neither does. */
export function topicFor(pathname: string, text: string): PageTopic | null {
  const path = pathname.toLowerCase().replace(/[_-]+/g, '-');
  const label = text.toLowerCase().replace(/\s+/g, ' ').trim();
  for (const topic of PAGE_TOPICS) {
    if (topic.path.test(path)) return topic.key;
  }
  for (const topic of PAGE_TOPICS) {
    if (label !== '' && label.length <= 60 && topic.text.test(label)) return topic.key;
  }
  return null;
}

/**
 * The same-site links on a page worth following, one entry per page, in
 * document order. Only http(s) links to another path on the same site count;
 * mailto, files, fragments and the page itself do not.
 */
export function extractCandidateLinks(html: string, pageUrl: URL): CandidateLink[] {
  const seen = new Set<string>([pageKey(pageUrl)]);
  const candidates: CandidateLink[] = [];
  const anchor = /<a\b[^>]*?\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))[^>]*>([\s\S]*?)<\/a\s*>/gi;

  for (const match of html.matchAll(anchor)) {
    const href = decodeEntities(match[1] ?? match[2] ?? match[3] ?? '').trim();
    if (href === '' || href.startsWith('#') || /^(mailto|tel|javascript|sms):/i.test(href)) continue;

    let url: URL;
    try {
      url = new URL(href, pageUrl);
    } catch {
      continue;
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') continue;
    if (!sameSite(url, pageUrl)) continue;
    if (NON_PAGE_PATH.test(url.pathname)) continue;
    url.hash = '';

    const key = pageKey(url);
    if (seen.has(key)) continue;

    const text = decodeEntities(match[4].replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
    const topic = topicFor(url.pathname, text);
    if (!topic) continue;

    seen.add(key);
    candidates.push({ url: url.toString(), topic, text });
  }
  return candidates;
}

/**
 * Which candidates get the remaining slots. One page per topic first, in
 * PAGE_TOPICS order, so a site with eight case studies still gets its about
 * page read; then whatever is left, in document order.
 */
export function choosePages(candidates: CandidateLink[], slots: number): CandidateLink[] {
  if (slots <= 0) return [];
  const chosen: CandidateLink[] = [];
  const taken = new Set<string>();

  for (const topic of PAGE_TOPICS) {
    if (chosen.length >= slots) break;
    const first = candidates.find((c) => c.topic === topic.key && !taken.has(c.url));
    if (first) {
      chosen.push(first);
      taken.add(first.url);
    }
  }
  for (const candidate of candidates) {
    if (chosen.length >= slots) break;
    if (taken.has(candidate.url)) continue;
    chosen.push(candidate);
    taken.add(candidate.url);
  }
  return chosen;
}

// ---------------------------------------------------------------
// Fetching
// ---------------------------------------------------------------

type FetchOutcome =
  | { ok: true; url: URL; html: string }
  | { ok: false; kind: SiteReadFailureKind; detail: string };

const REQUEST_HEADERS = {
  'user-agent': 'Mozilla/5.0 (compatible; CadenceSiteReader/1.0)',
  accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5',
  'accept-language': 'en',
};

/** The first htmlBytes of a body, decoded. Stops reading once it has them. */
async function readBody(response: Response, cap: number): Promise<string> {
  if (!response.body) return await response.text();
  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: false });
  let out = '';
  let received = 0;
  try {
    while (received < cap) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      out += decoder.decode(value, { stream: true });
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  return out + decoder.decode();
}

/**
 * One page, redirects followed by hand so every hop is checked against the
 * blocked-host rules, within `ms` for all hops together.
 */
async function fetchPage(
  start: URL,
  ms: number,
  deps: Required<Pick<SiteReaderDeps, 'fetch' | 'lookup' | 'now'>>
): Promise<FetchOutcome> {
  const deadline = deps.now() + ms;
  let url = start;

  for (let hop = 0; hop <= SITE_READER_LIMITS.redirects; hop += 1) {
    if (isBlockedHostname(url.hostname)) {
      return { ok: false, kind: 'blocked_host', detail: `${url.hostname} is not a public host` };
    }
    try {
      const addresses = await deps.lookup(url.hostname);
      if (addresses.length === 0 || addresses.some(isPrivateAddress)) {
        return { ok: false, kind: 'blocked_host', detail: `${url.hostname} does not resolve to a public address` };
      }
    } catch (err) {
      return { ok: false, kind: 'unreachable', detail: `${url.hostname} could not be found (${errorCode(err)})` };
    }

    const remaining = deadline - deps.now();
    if (remaining <= 0) return { ok: false, kind: 'timeout', detail: `${url.host} did not answer in time` };

    let response: Response;
    try {
      response = await deps.fetch(url.toString(), {
        method: 'GET',
        headers: REQUEST_HEADERS,
        redirect: 'manual',
        signal: AbortSignal.timeout(remaining),
      });
    } catch (err) {
      if (isTimeout(err)) return { ok: false, kind: 'timeout', detail: `${url.host} did not answer in time` };
      return { ok: false, kind: 'unreachable', detail: `${url.host} could not be reached (${errorCode(err)})` };
    }

    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location');
      await response.body?.cancel().catch(() => undefined);
      if (!location) return { ok: false, kind: 'http_error', detail: `${url.host} redirected nowhere` };
      let next: URL;
      try {
        next = new URL(location, url);
      } catch {
        return { ok: false, kind: 'http_error', detail: `${url.host} redirected to an unusable address` };
      }
      if (next.protocol !== 'http:' && next.protocol !== 'https:') {
        return { ok: false, kind: 'http_error', detail: `${url.host} redirected off the web (${next.protocol})` };
      }
      next.hash = '';
      url = next;
      continue;
    }

    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      return { ok: false, kind: 'http_error', detail: `${url.host} answered ${response.status}` };
    }

    const type = (response.headers.get('content-type') ?? '').toLowerCase();
    if (type !== '' && !type.includes('html') && !type.includes('xml')) {
      await response.body?.cancel().catch(() => undefined);
      return { ok: false, kind: 'not_html', detail: `${url.host} sent ${type.split(';')[0]}, not a web page` };
    }

    let html: string;
    try {
      html = await readBody(response, SITE_READER_LIMITS.htmlBytes);
    } catch (err) {
      if (isTimeout(err)) return { ok: false, kind: 'timeout', detail: `${url.host} did not finish sending in time` };
      return { ok: false, kind: 'unreachable', detail: `${url.host} dropped the connection (${errorCode(err)})` };
    }
    return { ok: true, url, html };
  }

  return { ok: false, kind: 'http_error', detail: `${start.host} redirected too many times` };
}

function isTimeout(err: unknown): boolean {
  return err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError');
}

/** The short code node attaches to a network failure, or the message. */
function errorCode(err: unknown): string {
  if (err && typeof err === 'object') {
    const cause = (err as { cause?: unknown }).cause;
    const code =
      (cause && typeof cause === 'object' && (cause as { code?: unknown }).code) ||
      (err as { code?: unknown }).code;
    if (typeof code === 'string') return code;
    if (cause instanceof Error && cause.message) return cause.message;
  }
  return err instanceof Error ? err.message : 'unknown error';
}

// ---------------------------------------------------------------
// The read
// ---------------------------------------------------------------

/**
 * Lines that appear on more than one page are the template, not the content:
 * a tagline in every hero, a footer the element stripping did not catch. Each
 * is kept where it first appears and dropped from the pages after, so the
 * combined text still contains it exactly once.
 */
export function dropRepeatedLines(pages: ReadPage[]): ReadPage[] {
  const seen = new Set<string>();
  return pages.map((page) => {
    const kept: string[] = [];
    for (const line of page.text.split('\n')) {
      if (line === '' || seen.has(line)) continue;
      seen.add(line);
      kept.push(line);
    }
    return { ...page, text: kept.join('\n') };
  });
}

/**
 * The homepage and up to five more pages from the same site, as text. See the
 * file comment for what fails the whole read and what is merely skipped.
 */
export async function readWebsite(input: string, deps: SiteReaderDeps = {}): Promise<SiteReadResult> {
  const now = deps.now ?? (() => Date.now());
  const io = { fetch: deps.fetch ?? fetch, lookup: deps.lookup ?? defaultLookup, now };
  const budget = deps.budgetMs ?? SITE_READER_LIMITS.budgetMs;
  const started = now();
  const deadline = started + budget;
  const pages: ReadPage[] = [];
  const skipped: SkippedPage[] = [];
  const fail = (kind: SiteReadFailureKind, detail: string): SiteReadResult => ({
    ok: false,
    kind,
    detail,
    pages,
    skipped,
    elapsedMs: now() - started,
  });

  const home = normaliseSiteUrl(input);
  if (!home) return fail('invalid_url', 'Enter the website as a web address, such as example.com');

  const homeOutcome = await fetchPage(home, Math.min(SITE_READER_LIMITS.pageMs, budget), io);
  if (!homeOutcome.ok) return fail(homeOutcome.kind, homeOutcome.detail);

  const homeText = htmlToText(homeOutcome.html);
  if (!hasReadableText(homeText.text)) {
    return fail(
      'no_text',
      `${homeOutcome.url.host} returned a page with almost no readable text. It is probably drawn by JavaScript in the browser, which this reader does not run.`
    );
  }
  pages.push({
    url: homeOutcome.url.toString(),
    title: homeText.title,
    text: homeText.text.slice(0, SITE_READER_LIMITS.pageChars),
  });

  // Links are resolved against the page the homepage ended up at, so a site
  // that redirects example.com to www.example.com is still one site.
  const candidates = extractCandidateLinks(homeOutcome.html, homeOutcome.url);
  const chosen = choosePages(candidates, SITE_READER_LIMITS.pages - 1);

  // The sub-pages are fetched together, each within what is left of the
  // budget, so five slow pages cost one page's wait rather than five.
  const remaining = deadline - now();
  const outcomes: Array<FetchOutcome | null> =
    remaining < 1_500
      ? chosen.map(() => null)
      : await Promise.all(
          chosen.map((candidate) =>
            fetchPage(new URL(candidate.url), Math.min(SITE_READER_LIMITS.pageMs, remaining), io)
          )
        );

  let totalChars = pages[0].text.length;
  chosen.forEach((candidate, index) => {
    const outcome = outcomes[index];
    if (!outcome) {
      skipped.push({ url: candidate.url, reason: 'out of time' });
      return;
    }
    if (!outcome.ok) {
      skipped.push({ url: candidate.url, reason: outcome.detail });
      return;
    }
    // A redirect can lead off the site or to a page already read.
    if (!sameSite(outcome.url, homeOutcome.url)) {
      skipped.push({ url: candidate.url, reason: `redirected off the site to ${outcome.url.host}` });
      return;
    }
    if (pages.some((page) => page.url === outcome.url.toString())) {
      skipped.push({ url: candidate.url, reason: 'same page as one already read' });
      return;
    }
    if (totalChars >= SITE_READER_LIMITS.totalChars) {
      skipped.push({ url: candidate.url, reason: 'enough text already read' });
      return;
    }

    const { title, text } = htmlToText(outcome.html);
    if (!hasReadableText(text)) {
      skipped.push({ url: candidate.url, reason: 'no readable text once scripts were removed' });
      return;
    }
    const room = Math.min(SITE_READER_LIMITS.pageChars, SITE_READER_LIMITS.totalChars - totalChars);
    const kept = text.slice(0, room);
    totalChars += kept.length;
    pages.push({ url: outcome.url.toString(), title, text: kept });
  });

  // A page that said little the pages before it had not is not evidence of
  // anything, so it is listed with the skipped rather than shown as read.
  const distinct: ReadPage[] = [];
  for (const page of dropRepeatedLines(pages)) {
    if (distinct.length > 0 && !hasReadableText(page.text)) {
      skipped.push({ url: page.url, reason: 'little beyond what earlier pages said' });
    } else {
      distinct.push(page);
    }
  }

  return {
    ok: true,
    domain: siteDomain(homeOutcome.url),
    pages: distinct,
    skipped,
    elapsedMs: now() - started,
  };
}

// ---------------------------------------------------------------
// Scraps, for the guesser
// ---------------------------------------------------------------

/** What one look at the homepage recovered, for a site the read gave up on. */
export interface SiteScraps {
  domain: string;
  title: string | null;
  /** The meta description, which a JavaScript shell usually still carries. */
  description: string | null;
  /** Whatever text survived stripping, however little. */
  text: string;
}

/**
 * One fetch of the homepage, for the profile guesser, after readWebsite has
 * failed. It returns what the head says about the page (title, meta
 * description) and whatever scraps of text there were, or null when nothing
 * came back. The same host rules apply; the budget is scrapsMs and no
 * further pages are asked for. A null is not an error: the guesser works
 * from the name and domain alone.
 */
export async function readSiteScraps(input: string, deps: SiteReaderDeps = {}): Promise<SiteScraps | null> {
  const now = deps.now ?? (() => Date.now());
  const io = { fetch: deps.fetch ?? fetch, lookup: deps.lookup ?? defaultLookup, now };
  const home = normaliseSiteUrl(input);
  if (!home) return null;

  const outcome = await fetchPage(home, deps.budgetMs ?? SITE_READER_LIMITS.scrapsMs, io);
  if (!outcome.ok) return null;

  const { title, text: body } = htmlToText(outcome.html);
  const description = extractMetaDescription(outcome.html);
  // The title reaches the text too, as its first line; here it has its own
  // slot, so it is not repeated as if the page said it twice.
  const text = body
    .split('\n')
    .filter((line, index) => !(index === 0 && line === title))
    .join('\n');
  if (!title && !description && text.trim() === '') return null;
  return {
    domain: siteDomain(outcome.url),
    title,
    description,
    text: text.slice(0, SITE_READER_LIMITS.scrapsChars),
  };
}
