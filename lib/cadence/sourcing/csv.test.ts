// lib/cadence/sourcing/csv.test.ts
//
// Run with `npm test`. Node runs these directly — csv.ts and the dedupeKey it
// borrows from apollo.ts are free of Next and of any live Supabase call, so no
// bundler and no database are involved.
//
// The cases that matter here are the ones where being wrong is expensive: a
// row whose identity we guess at becomes a duplicate person, a country we
// truncate picks the wrong consent rulebook, and a header we mis-claim writes
// the company's country onto the contact.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { dedupeKey } from './apollo.ts';
import {
  CsvImportError,
  detectDelimiter,
  isRoleAddress,
  mapColumns,
  normaliseCountry,
  normaliseDomain,
  normaliseEmail,
  normaliseEmployeeCount,
  normaliseLinkedIn,
  normalisePhone,
  parseCsv,
  parseLeadCsv,
} from './csv.ts';

/** The header row Apollo writes, trimmed to the columns the importer reads. */
const APOLLO_HEADER = [
  'First Name',
  'Last Name',
  'Title',
  'Company',
  'Company Name for Emails',
  'Email',
  'Email Status',
  'Seniority',
  'Work Direct Phone',
  'Mobile Phone',
  '# Employees',
  'Industry',
  'Person Linkedin Url',
  'Website',
  'City',
  'State',
  'Country',
  'Company Country',
  'Apollo Contact Id',
].join(',');

// ---------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------

test('parses quoted fields, escaped quotes and CRLF endings', () => {
  const rows = parseCsv('a,b,c\r\n1,"two, with comma","he said ""hi"""\r\n');

  assert.deepEqual(rows, [
    ['a', 'b', 'c'],
    ['1', 'two, with comma', 'he said "hi"'],
  ]);
});

test('a quote inside an unquoted field is a character, not a quoted section', () => {
  const rows = parseCsv('name,product\nAcme,5" pipe fittings\nBeta,widgets\n');

  assert.deepEqual(rows[1], ['Acme', '5" pipe fittings']);
  assert.deepEqual(rows[2], ['Beta', 'widgets']);
});

test('a quoted field may contain newlines', () => {
  const rows = parseCsv('a,b\n"line one\nline two",x\n');

  assert.deepEqual(rows[1], ['line one\nline two', 'x']);
});

test('a byte order mark does not become part of the first header', () => {
  const rows = parseCsv('﻿Email,Name\na@b.com,Ann\n');

  assert.equal(rows[0][0], 'Email');
});

test('a trailing newline does not produce a phantom final row', () => {
  assert.equal(parseCsv('a,b\n1,2\n').length, 2);
  assert.equal(parseCsv('a,b\n1,2').length, 2);
});

test('detects the semicolon and tab delimiters Excel writes', () => {
  assert.equal(detectDelimiter('Email;Name;Title\n'), ';');
  assert.equal(detectDelimiter('Email\tName\tTitle\n'), '\t');
  assert.equal(detectDelimiter('Email,Name,Title\n'), ',');
  // A comma inside a quoted header is not a delimiter vote.
  assert.equal(detectDelimiter('"Last, First";Email\n'), ';');
});

// ---------------------------------------------------------------
// Column mapping
// ---------------------------------------------------------------

test('maps the Apollo export header row', () => {
  const { columns } = mapColumns(APOLLO_HEADER.split(','));

  assert.equal(columns.first_name, 0);
  assert.equal(columns.last_name, 1);
  assert.equal(columns.title, 2);
  assert.equal(columns.company_name, 3);
  assert.equal(columns.email, 5);
  assert.equal(columns.phone, 8);
  assert.equal(columns.employee_count, 10);
  assert.equal(columns.industry, 11);
  assert.equal(columns.linkedin_url, 12);
  assert.equal(columns.company_domain, 13);
  assert.equal(columns.source_record_id, 18);
});

test('the person country wins over the company country when both are present', () => {
  const headers = APOLLO_HEADER.split(',');

  assert.equal(mapColumns(headers).columns.country, headers.indexOf('Country'));
});

test('the company country is used when the person country is absent', () => {
  const { columns } = mapColumns(['Email', 'Company Country']);

  assert.equal(columns.country, 1);
});

test('headers nothing claims are reported rather than silently dropped', () => {
  const { unmapped } = mapColumns(['Email', 'Email Status', 'Seniority', 'Technologies']);

  assert.deepEqual(
    unmapped.map((column) => column.header),
    ['Email Status', 'Seniority', 'Technologies']
  );
});

test('a header is claimed once, so a near-duplicate does not overwrite it', () => {
  const { columns, unmapped } = mapColumns(['Email', 'Work Email']);

  assert.equal(columns.email, 0);
  assert.deepEqual(
    unmapped.map((column) => column.header),
    ['Work Email']
  );
});

test('generic headers still map when Apollo names are absent', () => {
  const { columns } = mapColumns([
    'Full Name',
    'Job Title',
    'Organization',
    'Domain',
    'Email Address',
    'Headcount',
    'LinkedIn',
  ]);

  assert.equal(columns.full_name, 0);
  assert.equal(columns.title, 1);
  assert.equal(columns.company_name, 2);
  assert.equal(columns.company_domain, 3);
  assert.equal(columns.email, 4);
  assert.equal(columns.employee_count, 5);
  assert.equal(columns.linkedin_url, 6);
});

// ---------------------------------------------------------------
// Field normalisers
// ---------------------------------------------------------------

test('emails lowercase, unwrap angle brackets, and reject what cannot be sent to', () => {
  assert.equal(normaliseEmail(' Priya.Nair@ACME.example '), 'priya.nair@acme.example');
  assert.equal(normaliseEmail('Priya Nair <priya@acme.example>'), 'priya@acme.example');
  assert.equal(normaliseEmail(''), null);
  assert.equal(normaliseEmail(undefined), null);
  assert.equal(normaliseEmail('not-an-email'), 'invalid');
  assert.equal(normaliseEmail('priya@acme'), 'invalid');
  assert.equal(normaliseEmail('a@b.com, c@d.com'), 'invalid');
});

test('domains lose the scheme, the www, the path and the port', () => {
  assert.equal(normaliseDomain('https://www.acme.example/careers?ref=x'), 'acme.example');
  assert.equal(normaliseDomain('ACME.example'), 'acme.example');
  assert.equal(normaliseDomain('acme.example:443'), 'acme.example');
  assert.equal(normaliseDomain('priya@acme.example'), 'acme.example');
  assert.equal(normaliseDomain('not a domain'), null);
  assert.equal(normaliseDomain('localhost'), null);
});

test('linkedin urls normalise to one canonical form, and non-linkedin is dropped', () => {
  assert.equal(
    normaliseLinkedIn('http://in.linkedin.com/in/priya-nair-123/'),
    'https://www.linkedin.com/in/priya-nair-123'
  );
  assert.equal(
    normaliseLinkedIn('linkedin.com/in/priya-nair-123?originalSubdomain=in'),
    'https://www.linkedin.com/in/priya-nair-123'
  );
  assert.equal(normaliseLinkedIn('https://twitter.com/priya'), null);
  assert.equal(normaliseLinkedIn('https://www.linkedin.com/'), null);
});

test('phones keep their digits and any plus, and never gain a guessed country code', () => {
  assert.equal(normalisePhone('+91 98765 43210'), '+919876543210');
  assert.equal(normalisePhone('(020) 7946 0958'), '02079460958');
  assert.equal(normalisePhone('+1 (415) 555-0132, +1 (415) 555-0199'), '+14155550132');
  assert.equal(normalisePhone('n/a'), null);
  assert.equal(normalisePhone('12345'), null);
});

test('employee counts read a number, a thousands separator or a range', () => {
  assert.equal(normaliseEmployeeCount('180'), 180);
  assert.equal(normaliseEmployeeCount('1,001'), 1001);
  assert.equal(normaliseEmployeeCount('51-200'), 51);
  assert.equal(normaliseEmployeeCount('11 to 50'), 11);
  assert.equal(normaliseEmployeeCount('unknown'), null);
  assert.equal(normaliseEmployeeCount(''), null);
});

test('countries map to ISO codes, and an unrecognised one is blank rather than wrong', () => {
  assert.equal(normaliseCountry('India'), 'IN');
  assert.equal(normaliseCountry('United States'), 'US');
  assert.equal(normaliseCountry('U.K.'), 'GB');
  assert.equal(normaliseCountry('in'), 'IN');
  // "Ruritania" must not become "RU". A blank country falls back to the
  // workspace jurisdiction; a wrong one picks another country's rulebook.
  assert.equal(normaliseCountry('Ruritania'), null);
});

test('role addresses are not people', () => {
  assert.equal(isRoleAddress('info@acme.example'), true);
  assert.equal(isRoleAddress('priya@acme.example'), false);
  assert.equal(isRoleAddress(null), false);
});

// ---------------------------------------------------------------
// End to end
// ---------------------------------------------------------------

const APOLLO_ROW = [
  'Priya',
  'Nair',
  'Head of Growth',
  'Acme Technologies',
  'Acme',
  'Priya.Nair@Acme.example',
  'verified',
  'head',
  '+91 98765 43210',
  '',
  // Apollo quotes the thousands separator, which is the only reason this row
  // still has nineteen fields.
  '"1,001"',
  'Financial Services',
  'http://in.linkedin.com/in/priya-nair/',
  'https://www.acme.example/',
  'Bengaluru',
  'Karnataka',
  'India',
  'India',
  '5f3a9c21',
].join(',');

test('an Apollo row becomes a normalised lead with its provenance kept', () => {
  const { leads, rejected, total } = parseLeadCsv(`${APOLLO_HEADER}\n${APOLLO_ROW}\n`);

  assert.equal(total, 1);
  assert.equal(rejected.length, 0);
  assert.equal(leads.length, 1);

  const lead = leads[0];
  assert.equal(lead.row, 2);
  assert.equal(lead.full_name, 'Priya Nair');
  assert.equal(lead.title, 'Head of Growth');
  assert.equal(lead.company_name, 'Acme Technologies');
  assert.equal(lead.company_domain, 'acme.example');
  assert.equal(lead.employee_count, 1001);
  assert.equal(lead.industry, 'Financial Services');
  assert.equal(lead.country, 'IN');
  assert.equal(lead.email, 'priya.nair@acme.example');
  assert.equal(lead.phone, '+919876543210');
  assert.equal(lead.linkedin_url, 'https://www.linkedin.com/in/priya-nair');
  assert.equal(lead.source, 'csv_import');
  assert.equal(lead.source_record_id, '5f3a9c21');
  assert.equal(lead.dedupe_key, 'priya.nair@acme.example');

  // Columns the mapping ignored are still on the lead, so the import can be
  // traced back to the exact row it came from.
  assert.equal(lead.raw['Email Status'], 'verified');
  assert.equal(lead.raw['Seniority'], 'head');
  assert.equal(lead.raw['City'], 'Bengaluru');
});

test('the dedupe key is the one the Apollo path writes, so imports dedupe across sources', () => {
  const { leads } = parseLeadCsv(
    'Name,Website\nPriya Nair,https://acme.example\n'
  );

  assert.equal(
    leads[0].dedupe_key,
    dedupeKey({ full_name: 'Priya Nair', company_domain: 'acme.example' })
  );
});

test('a row with no email and no domain is rejected, not guessed at', () => {
  const { leads, rejected } = parseLeadCsv('Name,Website,Title\nPriya Nair,,Head of Growth\n');

  assert.equal(leads.length, 0);
  assert.deepEqual(rejected.map((row) => [row.row, row.reason]), [[2, 'no_identity']]);
});

test('a malformed email rejects its own row and leaves the rest of the file alone', () => {
  const { leads, rejected } = parseLeadCsv(
    ['Email,Name', 'priya@acme.example,Priya Nair', 'priya[at]acme.example,Broken Row', 'sam@acme.example,Sam Rivers'].join('\n')
  );

  assert.deepEqual(leads.map((lead) => lead.email), [
    'priya@acme.example',
    'sam@acme.example',
  ]);
  assert.deepEqual(rejected, [
    { row: 3, reason: 'invalid_email', detail: 'priya[at]acme.example' },
  ]);
});

test('a role address is rejected with its own reason', () => {
  const { leads, rejected } = parseLeadCsv('Email,Name\ninfo@acme.example,Acme Desk\n');

  assert.equal(leads.length, 0);
  assert.equal(rejected[0].reason, 'role_address');
});

test('a row with more values than headers is rejected rather than shifted', () => {
  const { rejected } = parseLeadCsv('Email,Name\npriya@acme.example,Priya,Nair,extra\n');

  assert.equal(rejected[0].reason, 'column_count_mismatch');
});

test('a short row is padded, not rejected', () => {
  const { leads, rejected } = parseLeadCsv('Email,Name,Title\npriya@acme.example,Priya Nair\n');

  assert.equal(rejected.length, 0);
  assert.equal(leads[0].title, null);
});

test('blank lines are dropped from the count rather than reported as rejects', () => {
  const { leads, rejected, total } = parseLeadCsv(
    'Email,Name\npriya@acme.example,Priya Nair\n\n,\n'
  );

  assert.equal(total, 1);
  assert.equal(leads.length, 1);
  assert.equal(rejected.length, 0);
});

test('a source column on the file overrides the default source per row', () => {
  const { leads } = parseLeadCsv('Email,Source\npriya@acme.example,apollo_saved_search\n', {
    defaultSource: 'csv_import',
  });

  assert.equal(leads[0].source, 'apollo_saved_search');
});

test('a file with no identity columns is refused before any row work', () => {
  assert.throws(
    () => parseLeadCsv('Title,Industry\nHead of Growth,Fintech\n'),
    (err: unknown) =>
      err instanceof CsvImportError && err.code === 'no_identity_columns'
  );
});

test('an empty file is refused', () => {
  assert.throws(
    () => parseLeadCsv(''),
    (err: unknown) => err instanceof CsvImportError && err.code === 'empty_file'
  );
});

test('a semicolon-delimited export parses the same as a comma one', () => {
  const { leads } = parseLeadCsv('Email;First Name;Last Name\npriya@acme.example;Priya;Nair\n');

  assert.equal(leads.length, 1);
  assert.equal(leads[0].full_name, 'Priya Nair');
});
