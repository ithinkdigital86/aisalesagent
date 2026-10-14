// lib/cadence/testing/route-loader.ts
//
// Lets node --test import code written for the Next bundler: the route files
// under app/ and the lib modules they use import through the `@/` alias and
// without extensions, which Node's own resolver does not understand. Not a
// test file itself; a test calls registerRouteLoader() and then imports the
// route with a dynamic import(), since static imports are resolved before any
// of the test's own code runs.
//
// `doubles` swaps whole modules, keyed by their `@/` specifier, for a test
// double. The swap is by resolved file, so a module reached through a
// relative import is swapped too. A package specifier (`next/cache`) is
// swapped wherever it is imported by exactly that name.

import * as nodeModule from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// module.registerHooks (Node 22.15+) postdates the @types/node this project
// pins, so the slice used here is declared by hand.
interface ResolveContext {
  parentURL?: string;
  conditions: string[];
  importAttributes: Record<string, string>;
}
interface ResolveResult {
  url: string;
  format?: string | null;
  shortCircuit?: boolean;
}
type ResolveHook = (
  specifier: string,
  context: ResolveContext,
  nextResolve: (specifier: string, context?: ResolveContext) => ResolveResult
) => ResolveResult;

const { registerHooks } = nodeModule as unknown as {
  registerHooks(hooks: { resolve: ResolveHook }): void;
};

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

/** The extensions the bundler tries, in its order, for a bare path. */
const CANDIDATES = ['.ts', '.tsx', '/index.ts', '/index.tsx'];

let registered = false;

function isMissing(err: unknown): boolean {
  const code = (err as { code?: string }).code;
  return code === 'ERR_MODULE_NOT_FOUND' || code === 'ERR_UNSUPPORTED_DIR_IMPORT';
}

export function registerRouteLoader(doubles: Record<string, string> = {}): void {
  if (registered) throw new Error('registerRouteLoader() called twice');
  registered = true;

  const swaps = new Map<string, string>();
  const packages = new Map<string, string>();
  for (const [specifier, replacement] of Object.entries(doubles)) {
    if (!specifier.startsWith('@/')) {
      packages.set(specifier, replacement);
      continue;
    }
    for (const ext of CANDIDATES) {
      swaps.set(pathToFileURL(path.join(ROOT, specifier.slice(2)) + ext).href, replacement);
    }
  }

  registerHooks({
    resolve(specifier, context, nextResolve) {
      const swappedPackage = packages.get(specifier);
      if (swappedPackage) return { url: swappedPackage, shortCircuit: true };

      const target = specifier.startsWith('@/')
        ? pathToFileURL(path.join(ROOT, specifier.slice(2))).href
        : specifier;

      // Project files get the bundler's extension search. A package subpath
      // with no exports map, like next/server, gets the `.js` the bundler
      // would have added; anything else resolves exactly as Node resolves it.
      const relative = target.startsWith('./') || target.startsWith('../');
      const local =
        target.startsWith('file:') ||
        (relative && !!context.parentURL && !context.parentURL.includes('/node_modules/'));
      const packageSubpath = !relative && !local && /^(@[^/]+\/)?[^/@.][^/]*\/.+/.test(target);
      const candidates = local ? CANDIDATES : packageSubpath ? ['.js'] : [];

      let resolved;
      try {
        resolved = nextResolve(target, context);
      } catch (err) {
        if (candidates.length === 0 || !isMissing(err)) throw err;
        resolved = undefined;
        for (const ext of candidates) {
          try {
            resolved = nextResolve(target + ext, context);
            break;
          } catch (inner) {
            if (!isMissing(inner)) throw inner;
          }
        }
        if (!resolved) throw err;
      }

      const swap = swaps.get(resolved.url);
      return swap ? { url: swap, shortCircuit: true } : resolved;
    },
  });
}
