import { createStarryNight } from '@wooorm/starry-night';
import type { Grammar } from '@wooorm/starry-night';
import type { ParseSource } from '../../CodeHighlighter/types';
import { resolveGrammarScope } from './grammarMaps';
import { grammarLoaders } from './grammarLoaders';
import { starryNightGutter } from './addLineGutters';
import { extendSyntaxTokens } from './extendSyntaxTokens';

type StarryNight = Awaited<ReturnType<typeof createStarryNight>>;

const STARRY_NIGHT_KEY = '__docs_infra_starry_night_instance__';
const STARRY_NIGHT_STATE_KEY = '__docs_infra_starry_night_state__';

interface StarryNightState {
  grammars: Map<string, Grammar>;
  instancePromise?: Promise<StarryNight>;
  registrationChain: Promise<void>;
}

// Set DEBUG=true to log grammar load/register failures (e.g. a chunk-load error
// after a rotated deploy, or offline). Off by default — a failed load fails open
// (the affected scope renders as plain text) per convention 9.3.
const DEBUG = false;

function getInstance(): StarryNight | undefined {
  return (globalThis as Record<string, unknown>)[STARRY_NIGHT_KEY] as StarryNight | undefined;
}

function getState(): StarryNightState {
  const globals = globalThis as Record<string, unknown>;
  let state = globals[STARRY_NIGHT_STATE_KEY] as StarryNightState | undefined;
  if (!state) {
    state = { grammars: new Map(), registrationChain: Promise.resolve() };
    globals[STARRY_NIGHT_STATE_KEY] = state;
  }
  return state;
}

// Builds the plain-text HAST fallback used for unsupported file types and for a
// mapped-but-not-yet-registered scope. Line gutters are still added so the
// enhancer pipeline (e.g. auto-focus frames) can operate on the result.
function createPlainTextRoot(source: string): ReturnType<ParseSource> {
  const root: ReturnType<ParseSource> = {
    type: 'root',
    children: [
      {
        type: 'text',
        value: source,
      },
    ],
  };
  const sourceLines = source.split(/\r?\n|\r/);
  starryNightGutter(root, sourceLines);
  return root;
}

/**
 * Parses source into a line-guttered HAST **without** syntax highlighting — the
 * raw text wrapped in the same `.line`/`.frame` structure `parseSource` produces,
 * just no starry-night tokenization. It is a `ParseSource` so it can be dropped
 * into the loader in place of the highlighting parser.
 *
 * Used for the deferred (un-highlighted) fallback: the enhancer pipeline needs the
 * line/frame structure to compute focus windows and truncation, but the syntax
 * colors are exactly the part being deferred — so we skip them. Cheap (no grammar,
 * no `getInstance`); the frames it produces collapse back to text via `buildRootFallback`.
 *
 * Takes only `source` (it ignores file name / language since it never highlights) but
 * stays structurally assignable to `ParseSource`, so it drops into the loader in place
 * of the highlighting parser.
 */
export const parsePlainText = (source: string): ReturnType<ParseSource> =>
  createPlainTextRoot(source);

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
  const starryNight = getInstance();
  if (!starryNight) {
    throw new Error(
      'Starry Night not initialized. Use createParseSource to create an initialized parseSource function.',
    );
  }

  // Determine the grammar scope: prefer explicit language, then fall back to file extension
  const grammarScope = resolveGrammarScope(fileName, language);

  if (!grammarScope) {
    // Unsupported file type: render the source as plain text.
    return createPlainTextRoot(source);
  }

  let highlighted;
  try {
    highlighted = starryNight.highlight(source, grammarScope);
  } catch (error) {
    // The scope maps to a grammar, but that grammar isn't registered yet — a
    // cold race before `ensureGrammars` resolves under lazy grammar loading.
    // Fall back to plain text; the block re-highlights on the next render once
    // the grammar is registered (a one-tick unstyled paint at worst).
    if (DEBUG) {
      console.error(`[docs-infra] grammar for scope "${grammarScope}" not registered`, error);
    }
    return createPlainTextRoot(source);
  }

  extendSyntaxTokens(highlighted, grammarScope); // mutates the tree to add di-* classes
  const sourceLines = source.split(/\r?\n|\r/);
  starryNightGutter(highlighted, sourceLines); // mutates the tree to add line gutters

  return highlighted;
};

// Resolves the per-scope grammar chunks, ignoring scopes with no loader (an
// unknown extension degrades to plain text rather than failing the batch).
async function loadGrammars(scopes: string[]): Promise<Grammar[]> {
  const loaded = await Promise.all(
    scopes.map((scope) => {
      const loader = grammarLoaders[scope];
      return loader ? loader() : undefined;
    }),
  );
  return loaded.filter((grammar): grammar is Grammar => grammar !== undefined);
}

async function createIfNeeded(initial: Grammar[]): Promise<StarryNight> {
  const existing = getInstance();
  if (existing) {
    return existing;
  }
  const state = getState();
  initial.forEach((grammar) => state.grammars.set(grammar.scopeName, grammar));
  if (!state.instancePromise) {
    state.instancePromise = createStarryNight([...state.grammars.values()]).then((instance) => {
      (globalThis as Record<string, unknown>)[STARRY_NIGHT_KEY] = instance;
      return instance;
    });
  }
  return state.instancePromise;
}

async function rebuildInstance(): Promise<StarryNight> {
  const state = getState();
  state.instancePromise = createStarryNight([...state.grammars.values()]).then((instance) => {
    (globalThis as Record<string, unknown>)[STARRY_NIGHT_KEY] = instance;
    return instance;
  });
  return state.instancePromise;
}

// Registry rebuilds replace the shared singleton, so serialize them globally.
// Client bundlers can instantiate this module more than once, but every copy
// still coordinates through the state stored on `globalThis`.

function enqueue(task: () => Promise<void>): Promise<void> {
  const state = getState();
  const next = state.registrationChain.then(task, task);
  state.registrationChain = next.catch(() => {});
  return next;
}

// Registers `requested` (and any grammar dependencies they pull in) into the
// singleton, creating an empty instance first if none exists. Idempotent: a
// scope already registered, in-flight from an earlier enqueued task, or without
// a loader is skipped. Runs under the registration mutex.
async function registerScopes(requested: string[]): Promise<void> {
  let instance = await createIfNeeded([]);
  const state = getState();

  let pending = [...new Set(requested)].filter(
    (scope) => grammarLoaders[scope] && !state.grammars.has(scope),
  );

  // Each round depends on the previous — register, then read the freshly-updated
  // `missingScopes()` for the next batch — so the awaits are necessarily
  // sequential (a dependency fixpoint), not a parallelizable loop.
  /* eslint-disable no-await-in-loop */
  while (pending.length > 0) {
    const grammars = await loadGrammars(pending);
    if (grammars.length > 0) {
      grammars.forEach((grammar) => state.grammars.set(grammar.scopeName, grammar));
      // Starry Night tracks registered scopes separately from its TextMate
      // registry. Rebuild and swap atomically so readiness and highlighting agree.
      instance = await rebuildInstance();
    }
    // `missingScopes()` surfaces hard grammar dependencies (e.g. source.mdx ->
    // source.tsx). Resolve the ones we have a loader for, to a fixpoint. The
    // loader-map intersection bounds this — a markdown fenced ```python block
    // references source.python, but with no loader it is left as plain text.
    pending = instance
      .missingScopes()
      .filter((scope) => grammarLoaders[scope] && !state.grammars.has(scope));
  }
  /* eslint-enable no-await-in-loop */
}

/**
 * Registers the grammars for the given scopes (and their dependencies) on the
 * global Starry Night instance, loading the per-scope chunks on demand.
 * Idempotent and deduped. Fails open: a chunk that fails to load leaves its
 * scope as plain text rather than rejecting the batch.
 *
 * This is the heavy implementation (it can create the engine instance). Client
 * code should call the light facade {@link ensureGrammars} from `./grammarCache`
 * instead, so the engine stays out of the client bundle until a block needs it.
 */
export async function registerGrammars(scopes: string[]): Promise<void> {
  if (scopes.length === 0) {
    return;
  }
  await enqueue(() => registerScopes(scopes));
}

async function registerAllGrammarsImpl(): Promise<void> {
  const { grammars } = await import('./grammars');
  await createIfNeeded([]);
  const state = getState();
  const missing = grammars.filter((grammar) => !state.grammars.has(grammar.scopeName));
  if (missing.length > 0) {
    missing.forEach((grammar) => state.grammars.set(grammar.scopeName, grammar));
    await rebuildInstance();
  }
}

// Registers every grammar from the all-in-one barrel. This public entry point
// must use the same mutex as per-scope registration.
export async function registerAllGrammars(): Promise<void> {
  await enqueue(registerAllGrammarsImpl);
}

/**
 * Initializes Starry Night and returns a configured `parseSource` function.
 * Only needs to be called once per application; the instance is stored globally
 * for reuse across calls.
 *
 * With no `initialScopes`, loads ALL grammars via the (lazy) `./grammars` barrel
 * — the eager `CodeProvider` / Node / build-time behavior, so the heavy TextMate
 * JSON is split into its own chunk but fully available. Pass `initialScopes`
 * (possibly `[]`) to create a lean instance that registers grammars on demand
 * via {@link registerGrammars} — the `CodeProviderLazy` per-language path.
 *
 * @returns A Promise that resolves to the initialized `parseSource` function
 */
export const createParseSource = async (initialScopes?: string[]): Promise<ParseSource> => {
  if (initialScopes === undefined) {
    await registerAllGrammars();
  } else if (initialScopes.length === 0) {
    await createIfNeeded([]);
  } else {
    await registerGrammars(initialScopes);
  }

  return parseSource;
};

/**
 * Clears the global Starry Night singleton and registration state. Intended for
 * tests exercising lazy registration from a known-empty registry.
 */
export function resetStarryNight(): void {
  const globals = globalThis as Record<string, unknown>;
  globals[STARRY_NIGHT_KEY] = undefined;
  globals[STARRY_NIGHT_STATE_KEY] = undefined;
}
