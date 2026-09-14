// lib/cadence/sourcing/csv.ts
//
// Turning an uploaded CSV into rows the leads table will accept. Everything in
// here is pure string work with no Next, Supabase or network import, so the
// rules that decide what counts as a usable lead can be exercised directly —
// see ./csv.test.ts — rather than only through an upload.
//
// Apollo's people export is the expected input, so its column names are the
// first alias for every field. Other exports (Sales Navigator, a CRM dump, a
// hand-built sheet) fall through to the more generic names underneath.
//
// The bias throughout is: reject a row rather than guess at its identity, and
// drop a field rather than invent a value for it. Nothing is lost by dropping —
// the untouched original row is kept on the lead as `raw`.

import { dedupeKey } from './apollo.ts';

/** A CSV this large is a mistake, not a list. Refused before any row work. */
export const MAX_ROWS = 5000;

/** Fields the importer can fill from a column. */
export type LeadField =
  | 'first_name'
  | 'last_name'
  | 'full_name'
  | 'title'
  | 'company_name'
  | 'company_domain'
  | 'employee_count'
  | 'industry'
  | 'country'
  | 'email'
  | 'phone'
  | 'linkedin_url'
  | 'source'
  | 'source_record_id';

/**
 * Header aliases, most specific first. A header is claimed by the first field
 * whose alias it matches exactly (after normalisation), and a claimed header is
 * not offered to any later field — which is what keeps Apollo's "Country" going
 * to the person and leaves "Company Country" alone when both are present.
 *
 * Order within a list is the tie-break, so read each one as a preference.
 */
const ALIASES: Record<LeadField, string[]> = {
  email: [
    'email',
    'email address',
    'work email',
    'business email',
    'person email',
    'primary email',
    'e mail',
  ],
  first_name: ['first name', 'firstname', 'given name', 'forename'],
  last_name: ['last name', 'lastname', 'surname', 'family name'],
  full_name: ['full name', 'name', 'contact name', 'person name', 'fullname', 'contact'],
  title: ['title', 'job title', 'person title', 'position', 'role', 'designation'],
  company_name: [
    'company',
    'company name',
    'organization',
    'organisation',
    'organization name',
    'organisation name',
    'account name',
    'employer',
    'company name for emails',
  ],
  company_domain: [
    'company domain',
    'primary domain',
    'domain',
    'website',
    'company website',
    'website url',
    'company url',
    'url',
  ],
  employee_count: [
    'employees',
    'of employees',
    'employee count',
    'number of employees',
    'num employees',
    'estimated num employees',
    'company size',
    'headcount',
    'employee range',
  ],
  industry: ['industry', 'company industry', 'primary industry', 'sector'],
  country: ['country', 'person country', 'contact country', 'location country', 'company country'],
  phone: [
    'work direct phone',
    'direct phone',
    'mobile phone',
    'phone',
    'phone number',
    'corporate phone',
    'company phone',
    'other phone',
    'work phone',
  ],
  linkedin_url: [
    'person linkedin url',
    'linkedin url',
    'linkedin profile',
    'linkedin profile url',
    'person linkedin',
    'linkedin',
  ],
  source: ['source', 'lead source', 'list', 'lists'],
  source_record_id: [
    'apollo contact id',
    'source record id',
    'contact id',
    'person id',
    'record id',
    'external id',
    'id',
  ],
};

/** The order fields get to claim a header. Identity fields go first. */
const CLAIM_ORDER: LeadField[] = [
  'email',
  'first_name',
  'last_name',
  'full_name',
  'company_domain',
  'company_name',
  'title',
  'employee_count',
  'industry',
  'country',
  'phone',
  'linkedin_url',
  'source_record_id',
  'source',
];

export interface ColumnMapping {
  /** Field to the zero-based column index that fills it. */
  columns: Partial<Record<LeadField, number>>;
  /** Headers no field claimed. Kept so the preview can show what was ignored. */
  unmapped: { index: number; header: string }[];
}

export type RejectReason =
  | 'empty_row'
  | 'column_count_mismatch'
  | 'invalid_email'
  | 'role_address'
  | 'no_identity';

/** One row that will not become a lead, and the reason it will not. */
export interface RejectedRow {
  /** 1-based line number in the file, with the header counted as line 1. */
  row: number;
  reason: RejectReason;
  detail?: string;
}

/** A row that survived normalisation. Shaped for a leads insert. */
export interface ImportedLead {
  row: number;
  full_name: string | null;
  title: string | null;
  company_name: string | null;
  company_domain: string | null;
  employee_count: number | null;
  industry: string | null;
  country: string | null;
  email: string | null;
  phone: string | null;
  linkedin_url: string | null;
  source: string;
  source_record_id: string | null;
  dedupe_key: string;
  /** The original row, header-keyed. Nothing the mapping dropped is lost. */
  raw: Record<string, string>;
}

export interface ParsedCsv {
  headers: string[];
  mapping: ColumnMapping;
  leads: ImportedLead[];
  rejected: RejectedRow[];
  /** Data rows seen, excluding the header and trailing blank lines. */
  total: number;
}

export type CsvErrorCode = 'empty_file' | 'no_header' | 'too_many_rows' | 'no_identity_columns';

export class CsvImportError extends Error {
  // Declared and assigned rather than a constructor parameter property: Node
  // runs these modules under type-stripping for `npm test`, which does not
  // rewrite `constructor(readonly code: ...)` into a field.
  readonly code: CsvErrorCode;

  constructor(code: CsvErrorCode, message: string) {
    super(message);
    this.name = 'CsvImportError';
    this.code = code;
  }
}

// ---------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------

const DELIMITERS = [',', ';', '\t'] as const;

/**
 * The delimiter the header line uses. Excel in a European locale writes
 * semicolons, and "save as tab delimited" is common enough to be worth
 * handling; anything else falls back to a comma.
 */
export function detectDelimiter(input: string): string {
  let end = 0;
  let quoted = false;
  while (end < input.length) {
    const ch = input[end];
    if (ch === '"') quoted = !quoted;
    else if (!quoted && (ch === '\n' || ch === '\r')) break;
    end++;
  }

  const line = input.slice(0, end);
  let best = ',';
  let bestCount = 0;
  for (const candidate of DELIMITERS) {
    let count = 0;
    let inQuotes = false;
    for (const ch of line) {
      if (ch === '"') inQuotes = !inQuotes;
      else if (!inQuotes && ch === candidate) count++;
    }
    if (count > bestCount) {
      best = candidate;
      bestCount = count;
    }
  }
  return best;
}

/**
 * RFC 4180 parse: quoted fields, a doubled quote as an escaped quote, and CRLF,
 * LF or CR line endings. A quote only opens a field at its start, so a stray
 * quote mid-value (a `5" pipe` product name) stays a character instead of
 * swallowing the rest of the file.
 */
export function parseCsv(text: string, delimiter?: string): string[][] {
  const input = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const sep = delimiter ?? detectDelimiter(input);

  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  let pending = false;
  let i = 0;

  while (i < input.length) {
    const ch = input[i];

    if (quoted) {
      if (ch === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        quoted = false;
        i++;
        continue;
      }
      field += ch;
      i++;
      continue;
    }

    if (ch === '"' && field === '') {
      quoted = true;
      pending = true;
      i++;
      continue;
    }

    if (ch === sep) {
      row.push(field);
      field = '';
      pending = true;
      i++;
      continue;
    }

    if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && input[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      pending = false;
      i++;
      continue;
    }

    field += ch;
    pending = true;
    i++;
  }

  if (pending || field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows;
}

// ---------------------------------------------------------------
// Column mapping
// ---------------------------------------------------------------

/** Lowercase, strip punctuation, collapse spaces: "# Employees" -> "employees". */
export function normaliseHeader(header: string): string {
  return header
    .replace(/^\uFEFF/, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function mapColumns(headers: string[]): ColumnMapping {
  const normalised = headers.map(normaliseHeader);
  const claimed = new Set<number>();
  const columns: Partial<Record<LeadField, number>> = {};

  for (const field of CLAIM_ORDER) {
    for (const alias of ALIASES[field]) {
      const index = normalised.findIndex((header, i) => header === alias && !claimed.has(i));
      if (index >= 0) {
        columns[field] = index;
        claimed.add(index);
        break;
      }
    }
  }

  const unmapped = headers
    .map((header, index) => ({ index, header }))
    .filter(({ index }) => !claimed.has(index));

  return { columns, unmapped };
}

/**
 * A mapping that cannot produce a dedupe key for any row is not worth running:
 * every row would be rejected. Identity needs an email, or a name and a domain.
 */
export function canIdentify(columns: ColumnMapping['columns']): boolean {
  if (columns.email !== undefined) return true;
  const hasName =
    columns.full_name !== undefined ||
    columns.first_name !== undefined ||
    columns.last_name !== undefined;
  return hasName && columns.company_domain !== undefined;
}

// ---------------------------------------------------------------
// Field normalisers
// ---------------------------------------------------------------

function clean(value: string | undefined, maxLength = 300): string | null {
  if (value === undefined) return null;
  const trimmed = value.replace(/\s+/g, ' ').trim();
  if (!trimmed) return null;
  return trimmed.slice(0, maxLength);
}

/**
 * Deliberately conservative: one @, a dotted domain, no spaces or list
 * separators. A value that fails this rejects the row rather than producing a
 * lead with an address nothing can send to.
 */
const EMAIL_RE =
  /^[^\s@,;<>"]+@[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/;

export function normaliseEmail(value: string | undefined): string | null | 'invalid' {
  const raw = clean(value, 320);
  if (!raw) return null;
  // Some exports carry "Name <addr>" rather than a bare address.
  const inner = raw.match(/<([^>]+)>/)?.[1] ?? raw;
  const candidate = inner.trim().toLowerCase();
  if (!candidate) return null;
  return EMAIL_RE.test(candidate) ? candidate : 'invalid';
}

/** Bare registrable host: no scheme, no www, no path, no port. */
export function normaliseDomain(value: string | undefined): string | null {
  const raw = clean(value, 255);
  if (!raw) return null;
  let host = raw.toLowerCase();
  if (host.includes('@')) host = host.slice(host.lastIndexOf('@') + 1);
  host = host.replace(/^[a-z][a-z0-9+.-]*:\/\//, '');
  host = host.split(/[/?#]/)[0];
  host = host
    .replace(/^www\./, '')
    .replace(/:\d+$/, '')
    .replace(/\.$/, '');
  if (!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/.test(host)) {
    return null;
  }
  return host;
}

export function normaliseLinkedIn(value: string | undefined): string | null {
  const raw = clean(value, 400);
  if (!raw) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase().replace(/^www\./, '');
  // Country subdomains (in.linkedin.com) point at the same profile.
  if (!/(^|\.)linkedin\.com$/.test(host)) return null;
  const path = url.pathname.replace(/\/+$/, '');
  if (!path || path === '/') return null;
  return `https://www.linkedin.com${path}`;
}

/**
 * Digits, and a leading + when the file gave us one. No country code is ever
 * added: a guessed prefix is a wrong number, and a wrong number on a channel
 * the consent gate guards is the expensive kind of wrong.
 */
export function normalisePhone(value: string | undefined): string | null {
  const raw = clean(value, 60);
  if (!raw) return null;
  // An export with several numbers in one cell: take the first.
  const first = raw.split(/[,;/]/)[0];
  const plus = first.trim().startsWith('+');
  const digits = first.replace(/\D/g, '');
  if (digits.length < 7 || digits.length > 15) return null;
  return plus ? `+${digits}` : digits;
}

/**
 * Apollo writes a plain number; other exports write "1,001", "51-200" or
 * "11 to 50". A range is read as its lower bound, which is the conservative
 * read against an ICP size band.
 */
export function normaliseEmployeeCount(value: string | undefined): number | null {
  const raw = clean(value, 40);
  if (!raw) return null;
  const first = raw.replace(/,/g, '').match(/\d+/)?.[0];
  if (!first) return null;
  const parsed = Number.parseInt(first, 10);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 10_000_000) return null;
  return parsed;
}

const COUNTRY_CODES: Record<string, string> = {
  india: 'IN',
  'united states': 'US',
  'united states of america': 'US',
  usa: 'US',
  us: 'US',
  america: 'US',
  australia: 'AU',
  'united kingdom': 'GB',
  uk: 'GB',
  'great britain': 'GB',
  england: 'GB',
  scotland: 'GB',
  wales: 'GB',
  canada: 'CA',
  singapore: 'SG',
  'united arab emirates': 'AE',
  uae: 'AE',
  germany: 'DE',
  france: 'FR',
  netherlands: 'NL',
  ireland: 'IE',
  spain: 'ES',
  italy: 'IT',
  'new zealand': 'NZ',
  'south africa': 'ZA',
  japan: 'JP',
  brazil: 'BR',
  mexico: 'MX',
  philippines: 'PH',
  indonesia: 'ID',
  malaysia: 'MY',
  israel: 'IL',
  sweden: 'SE',
  switzerland: 'CH',
  poland: 'PL',
};

/**
 * ISO 3166 alpha-2, or null.
 *
 * Null matters here. The consent gate picks a jurisdiction from this column and
 * falls back to the workspace default when it is empty, so an unrecognised
 * country left blank is handled correctly, while a country truncated to its
 * first two letters ("Germany" -> "GE", which is Georgia) would silently pick
 * the wrong rulebook. The original text survives on the lead's raw payload.
 */
export function normaliseCountry(value: string | undefined): string | null {
  const raw = clean(value, 60);
  if (!raw) return null;
  const key = raw.toLowerCase().replace(/\./g, '').trim();
  const mapped = COUNTRY_CODES[key];
  if (mapped) return mapped;
  if (/^[a-z]{2}$/i.test(raw)) return raw.toUpperCase();
  return null;
}

/** "Priya", "Nair" and "Priya Nair" all arrive; any one of them is enough. */
function fullNameFrom(
  full: string | null,
  first: string | null,
  last: string | null
): string | null {
  if (full) return full;
  const joined = [first, last].filter(Boolean).join(' ').trim();
  return joined || null;
}

// ---------------------------------------------------------------
// Row normalisation
// ---------------------------------------------------------------

/** Generic inboxes are not people; the Apollo path drops them for the same reason. */
const ROLE_ADDRESS_RE =
  /^(info|contact|hello|support|admin|sales|enquiries|enquiry|office|team|help|noreply|no-reply)@/;

export function isRoleAddress(email: string | null): boolean {
  return email !== null && ROLE_ADDRESS_RE.test(email);
}

export type RowOutcome =
  | { ok: true; lead: Omit<ImportedLead, 'row'> }
  | { ok: false; reason: RejectReason; detail?: string };

export function normaliseRow(
  values: string[],
  headers: string[],
  mapping: ColumnMapping,
  defaultSource: string
): RowOutcome {
  if (values.every((value) => value.trim() === '')) {
    return { ok: false, reason: 'empty_row' };
  }
  // Fewer values than headers is a short row and is padded out by `at` below.
  // More values than headers means the quoting broke, and every field past the
  // break is in the wrong column, so the row is not salvageable.
  if (values.length > headers.length) {
    return {
      ok: false,
      reason: 'column_count_mismatch',
      detail: `${values.length} values for ${headers.length} columns`,
    };
  }

  const at = (field: LeadField): string | undefined => {
    const index = mapping.columns[field];
    return index === undefined ? undefined : values[index];
  };

  const email = normaliseEmail(at('email'));
  if (email === 'invalid') {
    return { ok: false, reason: 'invalid_email', detail: clean(at('email'), 80) ?? '' };
  }
  if (isRoleAddress(email)) {
    return { ok: false, reason: 'role_address', detail: email ?? '' };
  }

  const full_name = fullNameFrom(
    clean(at('full_name'), 200),
    clean(at('first_name'), 100),
    clean(at('last_name'), 100)
  );
  const company_domain = normaliseDomain(at('company_domain'));

  // The same key the Apollo path writes, so an import dedupes against leads
  // sourced any other way rather than only against itself.
  const key = dedupeKey({ email, full_name, company_domain });
  if (!key) {
    return {
      ok: false,
      reason: 'no_identity',
      detail: 'needs an email, or a name and a company domain',
    };
  }

  const raw: Record<string, string> = {};
  headers.forEach((header, index) => {
    const value = values[index];
    if (header !== '' && value !== undefined && value.trim() !== '') raw[header] = value.trim();
  });

  return {
    ok: true,
    lead: {
      full_name,
      title: clean(at('title'), 200),
      company_name: clean(at('company_name'), 200),
      company_domain,
      employee_count: normaliseEmployeeCount(at('employee_count')),
      industry: clean(at('industry'), 120),
      country: normaliseCountry(at('country')),
      email,
      phone: normalisePhone(at('phone')),
      linkedin_url: normaliseLinkedIn(at('linkedin_url')),
      source: clean(at('source'), 80) ?? defaultSource,
      source_record_id: clean(at('source_record_id'), 120),
      dedupe_key: key,
      raw,
    },
  };
}

// ---------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------

export function parseLeadCsv(input: string, opts: { defaultSource?: string } = {}): ParsedCsv {
  const defaultSource = opts.defaultSource ?? 'csv_import';
  const rows = parseCsv(input);

  if (!rows.length) throw new CsvImportError('empty_file', 'The file is empty.');

  const headers = rows[0].map((header) => header.replace(/^\uFEFF/, '').trim());
  if (headers.every((header) => header === '')) {
    throw new CsvImportError('no_header', 'The first line has to be a header row.');
  }

  const body = rows.slice(1);
  if (body.length > MAX_ROWS) {
    throw new CsvImportError(
      'too_many_rows',
      `${body.length} rows. Split the file: the importer takes ${MAX_ROWS} at a time.`
    );
  }

  const mapping = mapColumns(headers);
  if (!canIdentify(mapping.columns)) {
    throw new CsvImportError(
      'no_identity_columns',
      'No email column, and no name plus company domain pair, so every row would be rejected. Check the header row.'
    );
  }

  const leads: ImportedLead[] = [];
  const rejected: RejectedRow[] = [];

  body.forEach((values, index) => {
    // The header is line 1, so the first data row is line 2.
    const row = index + 2;
    const outcome = normaliseRow(values, headers, mapping, defaultSource);
    if (outcome.ok) leads.push({ row, ...outcome.lead });
    else if (outcome.reason !== 'empty_row') {
      rejected.push({ row, reason: outcome.reason, detail: outcome.detail });
    }
  });

  // Blank lines are not something an operator needs told about, so they leave
  // the total rather than showing up as rejected rows.
  const blanks = body.length - leads.length - rejected.length;

  return { headers, mapping, leads, rejected, total: body.length - blanks };
}
