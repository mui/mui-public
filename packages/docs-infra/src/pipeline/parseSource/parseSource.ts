import type { Root } from 'hast';
import type { ParseSource } from '../../CodeHighlighter/types';
import { resolveGrammarScope } from './grammarMaps';
import { grammarLoaders } from './grammarLoaders';
import type { Grammar } from './grammarLoaders';
import { starryNightGutter } from './addLineGutters';
import { createPlainTextRoot } from './createPlainTextRoot';
import { extendSyntaxTokens } from './extendSyntaxTokens';

type HighlightToHast = (source: string, scope: string) => Root | undefined;

/** The shared highlighter: the engine plus the grammar scopes registered with it. */
export interface Highlighter {
  /** Highlights `source` for a registered scope; `undefined` when it cannot. */
  highlight: HighlightToHast;
  /** The registered grammar scopes. */
  scopes: () => readonly string[];
}

interface HighlighterState {
  registered: Set<string>;
  highlight?: HighlightToHast;
  enginePromise?: Promise<HighlightToHast>;
}

// Must match HIGHLIGHTER_KEY in ./grammarCache, which reads the instance without
// importing this module.
const HIGHLIGHTER_KEY = '__docs_infra_highlighter_instance__';
const HIGHLIGHTER_STATE_KEY = '__docs_infra_highlighter_state__';

// Set DEBUG=true to log engine load failures (e.g. a chunk-load error after a
// rotated deploy, or offline). Off by default — a failed load fails open (the
// affected scopes render as plain text) per convention 9.3.
const DEBUG = false;

function getInstance(): Highlighter | undefined {
  return (globalThis as Record<string, unknown>)[HIGHLIGHTER_KEY] as Highlighter | undefined;
}

// Client bundlers can instantiate this module more than once, so the state is
// shared through `globalThis`.
function getState(): HighlighterState {
  const globals = globalThis as Record<string, unknown>;
  let state = globals[HIGHLIGHTER_STATE_KEY] as HighlighterState | undefined;
  if (!state) {
    state = { registered: new Set() };
    globals[HIGHLIGHTER_STATE_KEY] = state;
  }
  return state;
}

function createIfNeeded(): Highlighter {
  const existing = getInstance();
  if (existing) {
    return existing;
  }
  const state = getState();
  const instance: Highlighter = {
    highlight: (source, scope) => state.highlight?.(source, scope),
    scopes: () => [...state.registered],
  };
  (globalThis as Record<string, unknown>)[HIGHLIGHTER_KEY] = instance;
  return instance;
}

export { parsePlainText } from './createPlainTextRoot';

/**
 * Parses source code into a HAST tree with syntax highlighting.
 *
 * @param source - The source code to parse and highlight
 * @param fileName - File name used to detect language via file extension
 * @param language - Optional explicit language override (e.g., 'tsx', 'css', 'typescript')
 * @returns HAST Root node containing highlighted code structure with line gutters
 * @throws Error if `createParseSource()` has not been called first
 */
export const parseSource: ParseSource = (source, fileName, language) => {
  const highlighter = getInstance();
  if (!highlighter) {
    throw new Error(
      'Highlighter not initialized. Use createParseSource to create an initialized parseSource function.',
    );
  }

  // Determine the grammar scope: prefer explicit language, then fall back to file extension
  const grammarScope = resolveGrammarScope(fileName, language);

  // A scope that isn't registered yet — a cold race before `ensureGrammars`
  // resolves under lazy loading — renders as plain text and re-highlights on the
  // next render once registered (a one-tick unstyled paint at worst).
  const highlighted =
    grammarScope && getState().registered.has(grammarScope)
      ? highlighter.highlight(source, grammarScope)
      : undefined;
  if (!grammarScope || !highlighted) {
    return createPlainTextRoot(source);
  }

  extendSyntaxTokens(highlighted, grammarScope); // mutates the tree to add di-* classes
  const sourceLines = source.split(/\r?\n|\r/);
  starryNightGutter(highlighted, sourceLines); // mutates the tree to add line gutters

  return highlighted;
};

/** Loads the engine module once; every language ships in it. */
async function loadEngine(): Promise<HighlightToHast> {
  const state = getState();
  if (!state.enginePromise) {
    state.enginePromise = (async () => {
      const { highlightToHast } = await import('./highlightToHast');
      state.highlight = highlightToHast;
      return highlightToHast;
    })();
    state.enginePromise.catch((error) => {
      state.enginePromise = undefined;
      if (DEBUG) {
        console.error('[docs-infra] failed to load the highlighter', error);
      }
    });
  }
  return state.enginePromise;
}

// Resolves the requested scopes and their dependencies (e.g. source.mdx ->
// source.tsx), ignoring scopes with no loader (an unknown extension degrades to
// plain text rather than failing the batch).
async function loadGrammars(scopes: string[]): Promise<Grammar[]> {
  const loaded: Grammar[] = [];
  let pending = [...new Set(scopes)].filter((scope) => grammarLoaders[scope]);
  const seen = new Set(pending);
  while (pending.length > 0) {
    // Each round depends on the previous one's dependencies.
    // eslint-disable-next-line no-await-in-loop
    const grammars = await Promise.all(pending.map((scope) => grammarLoaders[scope]()));
    loaded.push(...grammars);
    pending = grammars
      .flatMap((grammar) => grammar.dependencies ?? [])
      .filter((scope) => grammarLoaders[scope] && !seen.has(scope));
    pending.forEach((scope) => seen.add(scope));
  }
  return loaded;
}

/**
 * Registers `scopes` (and any grammar dependencies they pull in) on the global
 * highlighter, creating it and loading the engine on demand. Idempotent and
 * deduped. Fails open: an engine that fails to load leaves the scopes as plain
 * text rather than rejecting.
 *
 * This is the heavy implementation (it can load the engine). Client code should
 * call the light facade {@link ensureGrammars} from `./grammarCache` instead, so
 * the engine stays out of the client bundle until a block needs it.
 */
export async function registerGrammars(scopes: string[]): Promise<void> {
  if (scopes.length === 0) {
    return;
  }
  createIfNeeded();
  const state = getState();
  const missing = scopes.filter((scope) => !state.registered.has(scope));
  if (missing.length === 0) {
    return;
  }
  const [grammars] = await Promise.all([loadGrammars(missing), loadEngine()]);
  grammars.forEach((grammar) => state.registered.add(grammar.scopeName));
}

/** Registers every supported grammar. */
export async function registerAllGrammars(): Promise<void> {
  await registerGrammars(Object.keys(grammarLoaders));
}

/**
 * Initializes the highlighter and returns a configured `parseSource` function.
 * Only needs to be called once per application; the instance is stored globally
 * for reuse across calls.
 *
 * With no `initialScopes`, registers ALL grammars — the eager `CodeProvider` /
 * Node / build-time behavior. Pass `initialScopes` (possibly `[]`) to create a
 * lean instance that registers grammars on demand via {@link registerGrammars} —
 * the `CodeProviderLazy` per-language path. The engine module itself is shared
 * by every language and loads with the first registration.
 *
 * @returns A Promise that resolves to the initialized `parseSource` function
 */
export const createParseSource = async (initialScopes?: string[]): Promise<ParseSource> => {
  if (initialScopes === undefined) {
    await registerAllGrammars();
  } else if (initialScopes.length === 0) {
    createIfNeeded();
  } else {
    await registerGrammars(initialScopes);
  }
  return parseSource;
};

/**
 * Returns the shared highlighter after registering every grammar.
 *
 * Inline highlighting can follow code that initialized a lazy subset, so it must
 * register the complete set before using the shared instance.
 */
export async function getHighlighter(): Promise<Highlighter> {
  await registerAllGrammars();
  return createIfNeeded();
}

/**
 * Clears the global highlighter singleton and registration state. Intended for
 * tests exercising lazy registration from a known-empty registry.
 */
export function resetHighlighter(): void {
  const globals = globalThis as Record<string, unknown>;
  globals[HIGHLIGHTER_KEY] = undefined;
  globals[HIGHLIGHTER_STATE_KEY] = undefined;
}
