import type { Root } from 'hast';
import type { ParseSource } from '../../CodeHighlighter/types';
import { grammarScopes, resolveGrammarScope } from './grammarMaps';
import { addLineGutters } from './addLineGutters';
import { createPlainTextRoot } from './createPlainTextRoot';
import { extendSyntaxTokens } from './extendSyntaxTokens';

/** The loaded highlighting engine, shared through `globalThis`. */
export interface Highlighter {
  /** Highlights `source` for a grammar scope; `undefined` when it cannot. */
  highlight: (source: string, scope: string) => Root | undefined;
  /** The grammar scopes the engine highlights. */
  scopes: () => readonly string[];
}

// Must match HIGHLIGHTER_KEY in ./grammarCache, which reads the instance without
// importing this module.
const HIGHLIGHTER_KEY = '__docs_infra_highlighter_instance__';
const HIGHLIGHTER_LOAD_KEY = '__docs_infra_highlighter_load__';

// Set DEBUG=true to log engine load failures (e.g. a chunk-load error after a
// rotated deploy, or offline). Off by default — a failed load fails open (code
// renders as plain text) per convention 9.3.
const DEBUG = false;

function getInstance(): Highlighter | undefined {
  return (globalThis as Record<string, unknown>)[HIGHLIGHTER_KEY] as Highlighter | undefined;
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
  const highlighted = grammarScope ? highlighter.highlight(source, grammarScope) : undefined;
  if (!grammarScope || !highlighted) {
    // Unsupported file type: render the source as plain text.
    return createPlainTextRoot(source);
  }

  extendSyntaxTokens(highlighted, grammarScope); // mutates the tree to add di-* classes
  const sourceLines = source.split(/\r?\n|\r/);
  addLineGutters(highlighted, sourceLines); // mutates the tree to add line gutters

  return highlighted;
};

/**
 * Loads the highlighting engine once and publishes it on `globalThis`. Client
 * bundlers can instantiate this module more than once, so the in-flight load is
 * shared through `globalThis` too.
 */
async function loadHighlighter(): Promise<Highlighter> {
  const existing = getInstance();
  if (existing) {
    return existing;
  }
  const globals = globalThis as Record<string, unknown>;
  let load = globals[HIGHLIGHTER_LOAD_KEY] as Promise<Highlighter> | undefined;
  if (!load) {
    load = (async () => {
      const { highlightToHast } = await import('./highlightToHast');
      const instance: Highlighter = {
        highlight: highlightToHast,
        scopes: () => grammarScopes,
      };
      globals[HIGHLIGHTER_KEY] = instance;
      return instance;
    })();
    globals[HIGHLIGHTER_LOAD_KEY] = load;
    load.catch((error) => {
      globals[HIGHLIGHTER_LOAD_KEY] = undefined;
      if (DEBUG) {
        console.error('[docs-infra] failed to load the highlighter', error);
      }
    });
  }
  return load;
}

/**
 * Makes the given scopes available to `parseSource`. Every supported language
 * ships in one engine module, so this loads the engine once and is a no-op
 * afterwards; scopes are accepted so callers can stay language-aware.
 *
 * This is the heavy implementation (it loads the engine). Client code should
 * call the light facade {@link ensureGrammars} from `./grammarCache` instead, so
 * the engine stays out of the client bundle until a block needs it.
 */
export async function registerGrammars(scopes: string[]): Promise<void> {
  if (scopes.length === 0) {
    return;
  }
  await loadHighlighter();
}

/** Loads the engine with every supported language. */
export async function registerAllGrammars(): Promise<void> {
  await loadHighlighter();
}

/**
 * Loads the highlighting engine and returns a configured `parseSource`
 * function. Only needs to be called once per application; the engine is stored
 * globally for reuse across calls.
 *
 * `initialScopes` is accepted for compatibility with language-aware callers;
 * the engine always includes every supported language.
 *
 * @returns A Promise that resolves to the initialized `parseSource` function
 */
export const createParseSource = async (
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  initialScopes?: string[],
): Promise<ParseSource> => {
  await loadHighlighter();
  return parseSource;
};

/** Returns the shared highlighting engine, loading it first if needed. */
export async function getHighlighter(): Promise<Highlighter> {
  return loadHighlighter();
}

/**
 * Clears the global highlighter singleton. Intended for tests exercising
 * loading from a known-empty state.
 */
export function resetHighlighter(): void {
  const globals = globalThis as Record<string, unknown>;
  globals[HIGHLIGHTER_KEY] = undefined;
  globals[HIGHLIGHTER_LOAD_KEY] = undefined;
}
