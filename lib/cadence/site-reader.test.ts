// lib/cadence/site-reader.test.ts
//
// Run with `npm test`. Nothing here touches the network: fetch and DNS are
// injected, and what is pinned is the reader's own behaviour. Which text
// survives the stripping, which links are followed and in what order, that
// the caps hold, that hosts which resolve privately are refused, and that
// each way a read can fail is reported as that failure and not another.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  choosePages,
  decodeEntities,
  dropRepeatedLines,
  extractCandidateLinks,
  extractMetaDescription,
  htmlToText,
  isBlockedHostname,
  isPrivateAddress,
  normaliseSiteUrl,
  readSiteScraps,
  readWebsite,
  SITE_READER_LIMITS,
  topicFor,
  type SiteReaderDeps,
} from './site-reader.ts';

// ---------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------

/** Enough words to clear minChars, so a page built from it counts as read. */
const PARAGRAPH =
  'We run outbound email for founder-led B2B companies that have no sales team of their own. Every message is reviewed by a person before it is sent, and we work month to month with no retainer lock-in. ';

function page(body: string, title = 'Acme'): string {
  return `<!doctype html><html><head><title>${title}</title>
<style>.x{color:red}</style><script>window.__NEXT_DATA__ = {"a":1};</script></head>
<body>
<header><nav><a href="/">Home</a><a href="/login">Log in</a></nav></header>
<main>${body}</main>
<footer><p>&copy; 2026 Acme Ltd. All rights reserved.</p></footer>
</body></html>`;
}

const HOME = page(`
  <h1>Outbound, done by people</h1>
  <p>${PARAGRAPH}</p>
  <a href="/about-us">About us</a>
  <a href="/services">Services</a>
  <a href="/pricing">Pricing</a>
  <a href="/customers">Customers</a>
  <a href="/industries">Industries</a>
  <a href="/blog">Blog</a>
  <a href="/case-studies/acme">Case study</a>
  <a href="https://twitter.com/acme">Twitter</a>
  <a href="/brochure.pdf">Brochure</a>
  <a href="mailto:hi@acme.example">Email</a>
  <a href="#top">Top</a>
`);

type Route = { html?: string; status?: number; headers?: Record<string, string>; delayMs?: number; error?: Error };

/** A fetch that serves canned pages and records what it was asked for. */
function fakeFetch(routes: Record<string, Route>, calls: string[] = []): typeof fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    calls.push(url);
    const route = routes[url] ?? routes[new URL(url).pathname];
    if (!route) return new Response('not found', { status: 404, headers: { 'content-type': 'text/html' } });
    if (route.error) throw route.error;
    if (route.delayMs) {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(resolve, route.delayMs);
        init?.signal?.addEventListener('abort', () => {
          clearTimeout(timer);
          reject(init.signal!.reason ?? new DOMException('aborted', 'AbortError'));
        });
      });
    }
    return new Response(route.html ?? '', {
      status: route.status ?? 200,
      headers: { 'content-type': 'text/html; charset=utf-8', ...route.headers },
    });
  }) as typeof fetch;
}

const publicLookup = async () => ['93.184.216.34'];

function deps(routes: Record<string, Route>, calls: string[] = [], extra: Partial<SiteReaderDeps> = {}): SiteReaderDeps {
  return { fetch: fakeFetch(routes, calls), lookup: publicLookup, ...extra };
}

// ---------------------------------------------------------------
// URLs and hosts
// ---------------------------------------------------------------

test('a bare domain becomes https and the fragment is dropped', () => {
  assert.equal(normaliseSiteUrl('acme.example')?.toString(), 'https://acme.example/');
  assert.equal(normaliseSiteUrl(' www.acme.example/about#team ')?.toString(), 'https://www.acme.example/about');
  assert.equal(normaliseSiteUrl('http://acme.example')?.protocol, 'http:');
});

test('what is not a web address is refused', () => {
  assert.equal(normaliseSiteUrl(''), null);
  assert.equal(normaliseSiteUrl('ftp://acme.example'), null);
  assert.equal(normaliseSiteUrl('javascript:alert(1)'), null);
  assert.equal(normaliseSiteUrl('localhost'), null);
  assert.equal(normaliseSiteUrl('not a url'), null);
});

test('private, loopback and link-local addresses are recognised', () => {
  for (const address of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.169.254', '0.0.0.0', '100.64.0.1', '::1', 'fc00::1', 'fd12::1', 'fe80::1', '::ffff:10.0.0.1']) {
    assert.equal(isPrivateAddress(address), true, address);
  }
  for (const address of ['93.184.216.34', '172.32.0.1', '8.8.8.8', '2606:4700::1111']) {
    assert.equal(isPrivateAddress(address), false, address);
  }
});

test('local hostnames are blocked before any lookup', () => {
  assert.equal(isBlockedHostname('localhost'), true);
  assert.equal(isBlockedHostname('db.internal'), true);
  assert.equal(isBlockedHostname('printer.local'), true);
  assert.equal(isBlockedHostname('127.0.0.1'), true);
  assert.equal(isBlockedHostname('[::1]'), true);
  assert.equal(isBlockedHostname('acme.example'), false);
});

// ---------------------------------------------------------------
// HTML to text
// ---------------------------------------------------------------

test('scripts, styles, navigation, header and footer do not reach the text', () => {
  const { title, text } = htmlToText(HOME);
  assert.equal(title, 'Acme');
  assert.match(text, /Outbound, done by people/);
  assert.match(text, /founder-led B2B companies/);
  assert.doesNotMatch(text, /__NEXT_DATA__/);
  assert.doesNotMatch(text, /color:red/);
  assert.doesNotMatch(text, /Log in/);
  assert.doesNotMatch(text, /All rights reserved/);
});

test('nested dropped elements are cleared, not left as a tail', () => {
  const html = '<body><nav><div><nav><a>Inner</a></nav></div><a>Outer</a></nav><p>Body text here</p></body>';
  const { text } = htmlToText(html);
  assert.doesNotMatch(text, /Inner|Outer/);
  assert.match(text, /Body text here/);
});

test('block elements become lines and whitespace runs collapse', () => {
  const { text } = htmlToText('<div><h2>  What   we do </h2><ul><li>Email</li><li>Calls</li></ul><p>A<br>B</p></div>');
  assert.equal(text, 'What we do\nEmail\nCalls\nA\nB');
});

test('entities are decoded, named and numeric', () => {
  assert.equal(decodeEntities('Tom &amp; Jerry &lt;3 &#39;quoted&#39; &#x2014; &nbsp;done &rsquo;'), "Tom & Jerry <3 'quoted' —  done ’");
  assert.equal(decodeEntities('&unknown; stays'), '&unknown; stays');
});

test('a JavaScript shell strips to almost nothing and is reported as such', async () => {
  const shell = '<html><head><title>App</title><script src="/app.js"></script></head><body><div id="root"></div><noscript>Enable JavaScript</noscript></body></html>';
  const result = await readWebsite('acme.example', deps({ '/': { html: shell } }));
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.kind, 'no_text');
    assert.match(result.detail, /JavaScript/);
    assert.equal(result.pages.length, 0);
  }
});

// ---------------------------------------------------------------
// Which links to follow
// ---------------------------------------------------------------

test('links are classified by path first, then by text', () => {
  assert.equal(topicFor('/about-us', 'Learn more'), 'about');
  assert.equal(topicFor('/what-we-do', ''), 'services');
  assert.equal(topicFor('/our_products', ''), 'products');
  assert.equal(topicFor('/plans', ''), 'pricing');
  assert.equal(topicFor('/case-studies/acme', ''), 'customers');
  assert.equal(topicFor('/sectors/retail', ''), 'industries');
  assert.equal(topicFor('/p/42', 'Who we serve'), 'industries');
  assert.equal(topicFor('/p/43', 'Pricing'), 'pricing');
  assert.equal(topicFor('/blog/2026/hello', 'Read more'), null);
  assert.equal(topicFor('/contact', 'Contact'), null);
});

test('only same-site page links with a topic are candidates, once each', () => {
  const home = new URL('https://www.acme.example/');
  const candidates = extractCandidateLinks(HOME, home);
  const urls = candidates.map((c) => c.url);
  assert.deepEqual(urls, [
    'https://www.acme.example/about-us',
    'https://www.acme.example/services',
    'https://www.acme.example/pricing',
    'https://www.acme.example/customers',
    'https://www.acme.example/industries',
    'https://www.acme.example/case-studies/acme',
  ]);
  assert.ok(!urls.some((u) => u.includes('twitter') || u.endsWith('.pdf') || u.includes('blog')));
});

test('www and the bare domain are the same site; another domain is not', () => {
  const html = '<a href="https://acme.example/about">About</a><a href="https://shop.acme.example/about">About the shop</a>';
  const candidates = extractCandidateLinks(html, new URL('https://www.acme.example/'));
  assert.deepEqual(candidates.map((c) => c.url), ['https://acme.example/about']);
});

test('slots go one per topic first, then to whatever is left', () => {
  const candidates = [
    { url: 'a/cs1', topic: 'customers' as const, text: '' },
    { url: 'a/cs2', topic: 'customers' as const, text: '' },
    { url: 'a/cs3', topic: 'customers' as const, text: '' },
    { url: 'a/about', topic: 'about' as const, text: '' },
    { url: 'a/pricing', topic: 'pricing' as const, text: '' },
  ];
  assert.deepEqual(choosePages(candidates, 3).map((c) => c.url), ['a/about', 'a/pricing', 'a/cs1']);
  assert.deepEqual(choosePages(candidates, 5).map((c) => c.url), ['a/about', 'a/pricing', 'a/cs1', 'a/cs2', 'a/cs3']);
  assert.deepEqual(choosePages(candidates, 0), []);
});

test('lines repeated across pages are kept once, on their first page', () => {
  const pages = dropRepeatedLines([
    { url: 'a', title: null, text: 'Tagline\nHome copy' },
    { url: 'b', title: null, text: 'Tagline\n\nAbout copy\nTagline' },
  ]);
  assert.equal(pages[0].text, 'Tagline\nHome copy');
  assert.equal(pages[1].text, 'About copy');
});

test('a page that only repeats earlier pages is listed as skipped, not shown as read', async () => {
  const same = page(`<p>${PARAGRAPH}</p>`);
  const result = await readWebsite(
    'acme.example',
    deps({
      '/': { html: HOME },
      '/about-us': { html: same },
    })
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.pages.length, 1);
  assert.ok(result.skipped.some((s) => s.reason === 'little beyond what earlier pages said'));
});

// ---------------------------------------------------------------
// The read
// ---------------------------------------------------------------

test('reads the homepage and the chosen pages, and lists what it skipped', async () => {
  const calls: string[] = [];
  const result = await readWebsite(
    'acme.example',
    deps(
      {
        '/': { html: HOME },
        '/about-us': { html: page(`<p>About. ${PARAGRAPH}</p>`, 'About Acme') },
        '/services': { html: page(`<p>Services. ${PARAGRAPH}</p>`, 'Services') },
        '/pricing': { status: 500, html: 'boom' },
        '/customers': { html: page('<p>Logos only</p>') },
        '/industries': { html: page(`<p>Industries. ${PARAGRAPH}</p>`, 'Industries') },
      },
      calls
    )
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.domain, 'acme.example');
  assert.deepEqual(
    result.pages.map((p) => p.title),
    ['Acme', 'About Acme', 'Services', 'Industries']
  );
  assert.deepEqual(
    result.skipped.map((s) => [new URL(s.url).pathname, s.reason]),
    [
      ['/pricing', 'acme.example answered 500'],
      ['/customers', 'no readable text once scripts were removed'],
    ]
  );
  // Homepage plus five: the sixth candidate (the case study) is never asked for.
  assert.equal(calls.length, SITE_READER_LIMITS.pages);
  assert.ok(!calls.some((c) => c.includes('case-studies')));
});

test('the homepage failing fails the read with the reason, and nothing is half read', async () => {
  const down = await readWebsite('acme.example', deps({ '/': { status: 503, html: '' } }));
  assert.equal(down.ok, false);
  if (!down.ok) {
    assert.equal(down.kind, 'http_error');
    assert.match(down.detail, /503/);
    assert.equal(down.pages.length, 0);
  }

  const cause = Object.assign(new Error('getaddrinfo ENOTFOUND acme.example'), { code: 'ENOTFOUND' });
  const unreachable = await readWebsite(
    'acme.example',
    deps({ '/': { error: Object.assign(new TypeError('fetch failed'), { cause }) } })
  );
  assert.equal(unreachable.ok, false);
  if (!unreachable.ok) {
    assert.equal(unreachable.kind, 'unreachable');
    assert.match(unreachable.detail, /ENOTFOUND/);
  }

  const notHtml = await readWebsite(
    'acme.example',
    deps({ '/': { html: '%PDF-1.4', headers: { 'content-type': 'application/pdf' } } })
  );
  assert.equal(notHtml.ok, false);
  if (!notHtml.ok) {
    assert.equal(notHtml.kind, 'not_html');
    assert.match(notHtml.detail, /application\/pdf/);
  }
});

test('a homepage that does not answer inside the budget is a timeout', async () => {
  const result = await readWebsite(
    'acme.example',
    deps({ '/': { html: HOME, delayMs: 200 } }, [], { budgetMs: 50 })
  );
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.kind, 'timeout');
    assert.match(result.detail, /did not answer in time/);
  }
});

test('sub-pages left when the budget runs out are skipped as out of time', async () => {
  let clock = 0;
  const result = await readWebsite(
    'acme.example',
    deps(
      {
        '/': { html: HOME },
        '/about-us': { html: page(`<p>About. ${PARAGRAPH}</p>`) },
      },
      [],
      {
        // Every glance at the clock costs a second, so by the time the homepage
        // is read there is nothing left for the pages behind it.
        now: () => (clock += 1_000),
        budgetMs: 4_000,
      }
    )
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.ok(result.pages.length >= 1);
  assert.ok(result.skipped.some((s) => s.reason === 'out of time'), JSON.stringify(result.skipped));
  assert.ok(result.pages.length + result.skipped.length <= SITE_READER_LIMITS.pages);
});

test('hosts that resolve to private addresses are refused, on every redirect hop', async () => {
  const direct = await readWebsite('intranet.acme.example', {
    fetch: fakeFetch({ '/': { html: HOME } }),
    lookup: async () => ['10.0.0.5'],
  });
  assert.equal(direct.ok, false);
  if (!direct.ok) assert.equal(direct.kind, 'blocked_host');

  const viaRedirect = await readWebsite('acme.example', {
    fetch: fakeFetch({
      'https://acme.example/': { status: 302, headers: { location: 'http://169.254.169.254/latest/meta-data/' } },
    }),
    lookup: async (host) => (host === 'acme.example' ? ['93.184.216.34'] : ['169.254.169.254']),
  });
  assert.equal(viaRedirect.ok, false);
  if (!viaRedirect.ok) assert.equal(viaRedirect.kind, 'blocked_host');
});

test('a redirect to www is followed and the links resolve against where it landed', async () => {
  const calls: string[] = [];
  const result = await readWebsite(
    'acme.example',
    deps(
      {
        'https://acme.example/': { status: 301, headers: { location: 'https://www.acme.example/' } },
        'https://www.acme.example/': { html: HOME },
        'https://www.acme.example/about-us': { html: page(`<p>About. ${PARAGRAPH}</p>`, 'About') },
      },
      calls
    )
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.domain, 'acme.example');
  assert.equal(result.pages[0].url, 'https://www.acme.example/');
  assert.ok(calls.includes('https://www.acme.example/about-us'));
});

test('per-page text is capped and the read stops asking once the total is reached', async () => {
  const long = (word: string) => page(`<p>${`${word} ${PARAGRAPH}`.repeat(400)}</p>`);
  const result = await readWebsite(
    'acme.example',
    deps({
      '/': { html: HOME.replace('</main>', `<p>${PARAGRAPH.repeat(400)}</p></main>`) },
      '/about-us': { html: long('About') },
      '/services': { html: long('Services') },
      '/pricing': { html: long('Pricing') },
      '/customers': { html: long('Customers') },
      '/industries': { html: long('Industries') },
    })
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  for (const p of result.pages) assert.ok(p.text.length <= SITE_READER_LIMITS.pageChars, p.url);
  const total = result.pages.reduce((sum, p) => sum + p.text.length, 0);
  assert.ok(total <= SITE_READER_LIMITS.totalChars, String(total));
  assert.ok(result.skipped.some((s) => s.reason === 'enough text already read'));
});

// ---------------------------------------------------------------
// Scraps, for the guesser
// ---------------------------------------------------------------

test('the meta description is read whatever the attribute order, with og as the fallback', () => {
  assert.equal(
    extractMetaDescription('<head><meta content="We run outbound &amp; more" name="description"></head>'),
    'We run outbound & more'
  );
  assert.equal(
    extractMetaDescription(
      "<head><meta property='og:description' content='Open graph line'><meta name=\"description\" content=\"  The real  one \"></head>"
    ),
    'The real one'
  );
  assert.equal(extractMetaDescription('<head><meta property="og:description" content="Only og"></head>'), 'Only og');
  assert.equal(extractMetaDescription('<head><meta name="description" content=""><meta name="viewport" content="x"></head>'), null);
  assert.equal(extractMetaDescription('<head></head><body><meta name="description" content="not in head"></body>'), null);
});

test('one look at a JavaScript shell recovers its title and description, and nothing more is asked for', async () => {
  const shell =
    '<html><head><title>Acme — outbound for founders</title><meta name="description" content="We run outbound email for founder-led companies."><script src="/app.js"></script></head><body><div id="root"></div></body></html>';
  const calls: string[] = [];
  const scraps = await readSiteScraps('www.acme.example', deps({ '/': { html: shell } }, calls));
  assert.deepEqual(scraps, {
    domain: 'acme.example',
    title: 'Acme — outbound for founders',
    description: 'We run outbound email for founder-led companies.',
    text: '',
  });
  assert.deepEqual(calls, ['https://www.acme.example/']);
});

test('scraps are null when the site cannot be reached or says nothing at all', async () => {
  const cause = Object.assign(new Error('getaddrinfo ENOTFOUND'), { code: 'ENOTFOUND' });
  assert.equal(
    await readSiteScraps('acme.example', deps({ '/': { error: Object.assign(new TypeError('fetch failed'), { cause }) } })),
    null
  );
  assert.equal(await readSiteScraps('acme.example', deps({ '/': { status: 503, html: '' } })), null);
  assert.equal(await readSiteScraps('acme.example', deps({ '/': { html: '<html><head></head><body></body></html>' } })), null);
  assert.equal(await readSiteScraps('not a url', deps({})), null);
  assert.equal(await readSiteScraps('localhost', deps({ '/': { html: HOME } })), null);
});

test('scrap text is capped, so a page with text but no links still costs little', async () => {
  const scraps = await readSiteScraps('acme.example', deps({ '/': { html: page(`<p>${PARAGRAPH.repeat(50)}</p>`) } }));
  assert.ok(scraps);
  assert.equal(scraps.title, 'Acme');
  assert.equal(scraps.description, null);
  assert.equal(scraps.text.length, SITE_READER_LIMITS.scrapsChars);
});
