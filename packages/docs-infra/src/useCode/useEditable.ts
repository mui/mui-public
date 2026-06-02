// `useEditable` is the lightweight, always-mounted shell for live code editing.
// It owns the editing state and refs (undo history, caret, the MutationObserver
// ref) so they survive across renders, but the heavy runtime — the
// contentEditable setup and the keyboard/paste/caret handlers — lives in the
// separately-loaded `./EditableEngine` chunk. `contentEditable` is applied to
// the element only once that engine resolves, so read-only code blocks never
// pull the engine into their bundle. The engine factory is injected (typically
// by `CodeProvider` via context); a built-in fallback keeps editing working
// without a provider. The original fork attribution lives in `./EditableEngine`.

import * as React from 'react';
import type { Position } from './useEditableUtils';
import type {
  Bounds,
  CreateEditableEngine,
  Edit,
  EditableEngine,
  EditableEngineContext,
  Options,
  State,
} from './EditableEngine';
import {
  peekEditingEngine,
  loadEditingEngine,
  preloadEditingEngine,
  resetEditingEngineCache,
} from './editingEngineCache';

export type { Position } from './useEditableUtils';
export type { Edit, Options } from './EditableEngine';
export type { EditingEngineLoader } from './editingEngineCache';

// A fresh empty snapshot per call — the pre-load `edit.getState()` must not hand
// out a shared mutable object, or one caller mutating it would corrupt the
// snapshot every other pre-load caller sees.
const emptySnapshot = (): { text: string; position: Position } => ({
  text: '',
  position: { position: 0, extent: 0, content: '', line: 0 },
});

// The resolved engine is cached in the shared `editingEngineCache` (so the
// FIRST editable block resolves the loader once and every block after attaches
// synchronously — and `useSourceEditing` shares the same warm module). These
// are back-compat aliases over that cache; the param is now an
// `EditingEngineLoader` (resolves the module, not just the factory).

/**
 * Eagerly loads the editing engine and primes the shared cache so the next
 * editable block attaches synchronously instead of after a load round-trip.
 * Optional — `useEditable` loads on demand anyway. Pass the provider's
 * `editingEngineLoader` to share its deduplication.
 */
export const preloadEditableEngine = preloadEditingEngine;

/**
 * Clears the shared editing-engine cache so the next editable block resolves its
 * loader from scratch. Intended for tests that exercise the cold path.
 */
export const resetEditableEngineCache = resetEditingEngineCache;

/**
 * The lightweight, always-mounted shell for live code editing. Owns the editing
 * state/refs and a stable `edit` proxy; the heavy runtime is loaded on demand
 * from `./EditableEngine` and `contentEditable` is applied only once it resolves.
 *
 * The host element (`elementRef.current`) is expected to be **stable for the
 * lifetime of the hook** once the block is editable: the engine attaches once
 * and its setup effect does not re-run on a node swap, so a caller that replaces
 * the bound element in place would leave `contentEditable` on the stale node.
 */
export const useEditable = <TPreParseResult = unknown>(
  elementRef: { current: HTMLElement | undefined | null },
  onChange: (text: string, position: Position, preParseResult?: TPreParseResult) => void,
  opts?: Options<TPreParseResult>,
): Edit => {
  // Normalize once into a non-optional local so the effects below can read
  // `config.X` directly without any non-null assertions on `opts`.
  const config: Options<TPreParseResult> = opts ?? {};

  const unblock = React.useState([])[1];

  // The editing state bag, the visible-region bounds, and a config snapshot are
  // all mutable refs the engine reads/writes. They're synced in the layout effect
  // below (never during render — React refs must not be touched while rendering).
  const stateRef = React.useRef<State | null>(null);
  const observerRef = React.useRef<MutationObserver | null>(null);
  const boundsRef = React.useRef<Bounds>({});
  const configRef = React.useRef<Options>(config);

  const [engine, setEngine] = React.useState<EditableEngine | null>(null);
  const engineRef = React.useRef<EditableEngine | null>(null);
  // Fires `onActivate` once per block lifetime, the first time the block engages
  // for editing (mount in `'eager'`; hover/focus/click in `'interaction'`).
  const activatedRef = React.useRef(false);

  // Stable Edit proxy. Delegates to the loaded engine; before the engine
  // resolves the mutators are no-ops and `getState` returns an empty snapshot
  // (matching the historical pre-mount behavior).
  const [edit] = React.useState<Edit>(() => ({
    update(content: string) {
      engineRef.current?.edit.update(content);
    },
    insert(append: string, offset?: number) {
      engineRef.current?.edit.insert(append, offset);
    },
    move(pos: number | { row: number; column: number }) {
      engineRef.current?.edit.move(pos);
    },
    getState() {
      return engineRef.current?.edit.getState() ?? emptySnapshot();
    },
  }));

  // Keep the mutable refs current. Runs every render in a layout effect (not
  // during render, so the React Compiler ref rules are satisfied) and before the
  // resolve effect below, so the engine is always built against fresh values.
  // The engine's handlers read these refs at event time, long after this commits.
  React.useLayoutEffect(() => {
    let editingState = stateRef.current;
    if (editingState === null) {
      editingState = {
        disconnected: false,
        onChange,
        pendingContent: null,
        queue: [],
        history: [],
        historyAt: -1,
        lastCommittedContent: null,
        domDirty: false,
        position: null,
        repeatFlushId: null,
        skipNextRestore: false,
        preParseAbort: null,
      };
      stateRef.current = editingState;
    } else {
      // `onChange` can change without a remount (e.g. controlled code updates the
      // closure), so refresh it every render. It's declared as a method on
      // `State`, so the assignment needs no cast.
      editingState.onChange = onChange;
    }
    const bounds = boundsRef.current;
    bounds.minColumn = config.minColumn;
    bounds.minRow = config.minRow;
    bounds.maxRow = config.maxRow;
    bounds.onBoundary = config.onBoundary;
    bounds.caretSelector = config.caretSelector;
    bounds.preParse = config.preParse;
    configRef.current = config;
  });

  // Resolve the engine when the block is editable. `'eager'` (default) loads on
  // mount; `'interaction'` defers the load until the user engages: hover
  // (pointerenter) warms the chunk so the eventual commit is instant, and focus
  // or click commits (loads + attaches). `contentEditable` is applied only after
  // the engine resolves (via `setup`).
  React.useLayoutEffect(() => {
    const editingState = stateRef.current;
    if (
      typeof window === 'undefined' ||
      config.disabled ||
      !elementRef.current ||
      !editingState ||
      engineRef.current
    ) {
      return undefined;
    }

    const loader = config.engineLoader;
    const ctx: EditableEngineContext = {
      elementRef,
      state: editingState,
      observerRef,
      boundsRef,
      configRef,
      unblock,
    };

    const attach = (create: CreateEditableEngine) => {
      if (engineRef.current) {
        return;
      }
      const created = create(ctx);
      engineRef.current = created;
      setEngine(created);
    };

    // Notify the host the block has engaged for editing, exactly once. The host
    // (e.g. `CodeHighlighter`) uses this to warm the rest of the live-editing
    // dependencies — grammars and the worker — at the activation moment.
    const notifyActivated = () => {
      if (activatedRef.current) {
        return;
      }
      activatedRef.current = true;
      configRef.current.onActivate?.();
    };

    let cancelled = false;
    // Attach the engine: synchronously from the warm shared cache (a later block
    // on the page, or a test pre-warm), otherwise via the loader. Fail open on a
    // load error — leave the block as read-only plain text rather than crash.
    const load = () => {
      const warmModule = peekEditingEngine();
      if (warmModule) {
        attach(warmModule.createEditableEngine);
        return;
      }
      Promise.resolve(loadEditingEngine(loader))
        .then((mod) => {
          if (!cancelled) {
            attach(mod.createEditableEngine);
          }
        })
        .catch(() => {});
    };

    if ((config.activation ?? 'eager') === 'eager') {
      notifyActivated();
      load();
      return () => {
        cancelled = true;
      };
    }

    // 'interaction': defer attaching (and thus `contentEditable`) until the user
    // engages the block, regardless of whether the engine is already cached.
    // Hover (pointerenter) warms the chunk so the eventual commit is instant;
    // focus and pointerdown commit (load + attach).
    const element = elementRef.current;
    const warm = () => {
      notifyActivated();
      preloadEditingEngine(loader).catch(() => {});
    };
    const commit = () => {
      notifyActivated();
      load();
    };
    element.addEventListener('pointerenter', warm);
    element.addEventListener('pointerdown', commit);
    element.addEventListener('focus', commit);
    return () => {
      cancelled = true;
      element.removeEventListener('pointerenter', warm);
      element.removeEventListener('pointerdown', commit);
      element.removeEventListener('focus', commit);
    };
    // `config.disabled` drives the re-run once the block becomes editable; the
    // refs the effect reads are stable (and a ref can't be a dependency), so they
    // are intentionally omitted.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config.disabled, config.engineLoader, config.activation]);

  // Per-render observe + caret-restore, delegated to the engine once it exists.
  React.useLayoutEffect(() => {
    if (typeof window === 'undefined' || !engine) {
      return undefined;
    }
    return engine.observeAndRestore();
  });

  // contentEditable setup + handler binding, delegated to the engine. Re-runs
  // once the engine resolves and on `disabled`/`indentation` changes (the engine
  // re-reads them and the previous cleanup detaches contentEditable first).
  React.useLayoutEffect(() => {
    if (typeof window === 'undefined' || !engine) {
      return undefined;
    }
    return engine.setup();
  }, [engine, config.disabled, config.indentation]);

  return edit;
};
