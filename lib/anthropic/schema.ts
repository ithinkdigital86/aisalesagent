// lib/anthropic/schema.ts
//
// Agent output fields come in two grades, and the difference decides whether a
// bad value is worth throwing away a model call.
//
// Essential fields drive database writes and outbound copy. A missing body or
// an unrecognised enum makes the run useless, so those stay strict and fail.
//
// Advisory fields are metadata we log, display, or ignore. A rationale two
// characters over a cap is not a reason to discard an Opus call, so those are
// coerced, clamped, or truncated on the way in and can never fail a parse.
//
// Every cap here should also be stated in the prompt that produces the field.
// Export a LIMITS object from the prompt file and interpolate it into both the
// schema and the prompt text so the two cannot drift apart.

import { z } from 'zod';

/** Best-effort text for a value of unknown shape. null means "nothing here". */
function toText(value: unknown): string | null {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (value === null || value === undefined) return null;
  try {
    return JSON.stringify(value);
  } catch {
    return null;
  }
}

/** Enum values arrive with stray casing, spaces, or hyphens often enough. */
function normaliseToken(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  return value.trim().toLowerCase().replace(/[\s-]+/g, '_');
}

function truncate(text: string, max: number): string {
  return text.length > max ? text.slice(0, max).trimEnd() : text;
}

/**
 * Required string, trimmed, with a cap that truncates rather than rejects.
 * Use for essential copy that has a display limit but must be present.
 */
export function essentialString(max: number) {
  return z
    .string()
    .trim()
    .min(1)
    .transform((text) => truncate(text, max));
}

/** Required number, tolerant of numeric strings and floats, strict on range. */
export function essentialInt(min: number, max: number) {
  return z.preprocess((value) => {
    const parsed = typeof value === 'string' ? Number(value.trim()) : value;
    return typeof parsed === 'number' && Number.isFinite(parsed) ? Math.round(parsed) : value;
  }, z.number().int().min(min).max(max));
}

/** Required enum, tolerant of casing and separators, strict on membership. */
export function essentialEnum<const T extends readonly [string, ...string[]]>(values: T) {
  return z.preprocess(normaliseToken, z.enum(values));
}

/** Advisory string: missing, wrong type, or overlong all resolve to a value. */
export function advisoryString(max: number, fallback = '') {
  return z.preprocess((value) => {
    const text = toText(value);
    if (text === null) return fallback;
    const trimmed = text.trim();
    return trimmed === '' ? fallback : truncate(trimmed, max);
  }, z.string());
}

/** Advisory number: coerced, rounded, clamped into range, never rejected. */
export function advisoryInt(min: number, max: number, fallback: number) {
  return z.preprocess((value) => {
    const parsed = typeof value === 'string' ? Number(value.trim()) : value;
    if (typeof parsed !== 'number' || !Number.isFinite(parsed)) return fallback;
    return Math.min(max, Math.max(min, Math.round(parsed)));
  }, z.number().int());
}

/** Advisory enum: anything unrecognised becomes the fallback. */
export function advisoryEnum<const T extends readonly [string, ...string[]]>(
  values: T,
  fallback: T[number]
) {
  return z.preprocess((value) => {
    const token = normaliseToken(value);
    return typeof token === 'string' && (values as readonly string[]).includes(token)
      ? token
      : fallback;
  }, z.enum(values));
}

/** Advisory list of strings. A bare string becomes a one-item list. */
export function advisoryStringArray(maxItems: number, maxLength: number) {
  return z.preprocess((value) => {
    const raw = Array.isArray(value) ? value : value === null || value === undefined ? [] : [value];
    return raw
      .map((item) => toText(item))
      .filter((item): item is string => item !== null && item.trim() !== '')
      .map((item) => truncate(item.trim(), maxLength))
      .slice(0, maxItems);
  }, z.array(z.string()));
}

/**
 * Advisory list of objects. Items that are not objects are dropped, and the
 * item schema itself must be built from advisory fields so it cannot throw.
 */
export function advisoryObjectArray<S extends z.ZodTypeAny>(item: S, maxItems: number) {
  return z.preprocess((value) => {
    if (!Array.isArray(value)) return [];
    return value
      .filter((entry) => typeof entry === 'object' && entry !== null && !Array.isArray(entry))
      .slice(0, maxItems);
  }, z.array(item));
}

/**
 * A short, quotable summary of a validation failure. This is what goes back to
 * the model on the retry and back to the caller in the error, so it names the
 * field and the rule rather than dumping the whole Zod error object.
 */
export function describeIssues(error: z.ZodError): string {
  const issues = error.issues.slice(0, 6).map((issue) => {
    const path = issue.path.length > 0 ? issue.path.join('.') : '(root)';
    return `${path}: ${issue.message}`;
  });
  const extra = error.issues.length > issues.length ? ` (+${error.issues.length - issues.length} more)` : '';
  return issues.join('; ') + extra;
}
