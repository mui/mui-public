'use client';

import * as React from 'react';
import EditorImport from 'react-simple-code-editor';
import type { EditableSourceProjection, HastRoot } from '../CodeHighlighter/types';
import { ensureGrammars } from '../pipeline/parseSource/grammarCache';
import { useGrammarsReady } from '../CodeHighlighter/useGrammarsReady';
import { useCodeContext, useDemandSourceParser } from '../CodeProvider/CodeContext';
import { hastToJsx } from '../pipeline/hastUtils';
import { resolveGrammarScope } from '../pipeline/parseSource/grammarMaps';
import { stripLeadingPerLine } from './stripLeadingPerLine';
import type { SetSource } from './useSourceEditing';

type EditorComponent = typeof EditorImport;

function resolveEditor(editor: EditorComponent | { default: EditorComponent }): EditorComponent {
  return 'default' in editor ? editor.default : editor;
}

const Editor = resolveEditor(EditorImport);

type EditorSource = string | (() => string);

function readSource(source: EditorSource) {
  return typeof source === 'string' ? source : source();
}

export interface CodeEditorProps {
  source: EditorSource;
  sourceHighlight?: React.ReactNode;
  sourceProjection?: EditableSourceProjection;
  expanded?: boolean;
  fileName?: string;
  displayFileName?: string;
  language?: string;
  className?: string;
  fallback?: React.ReactNode;
  setSource?: SetSource;
  onActivate?: () => void;
  onBoundary?: () => void;
  onExit?: () => void;
  onReady?: (textarea: HTMLTextAreaElement) => void;
}

function getEditorValue(
  source: EditorSource,
  sourceProjection: EditableSourceProjection | undefined,
  expanded: boolean,
): string {
  if (expanded || !sourceProjection) {
    return readSource(source);
  }
  const indentationLength = sourceProjection.indentation?.length ?? 0;
  return stripLeadingPerLine(sourceProjection.source, indentationLength, indentationLength);
}

function restoreProjectionIndentation(source: string, indentation: string | undefined): string {
  if (!indentation) {
    return source;
  }
  return `${indentation}${source.replaceAll('\n', `\n${indentation}`)}`;
}

function toCanonicalProjectionOffset(
  source: string,
  offset: number,
  indentation: string | undefined,
): number {
  if (!indentation) {
    return offset;
  }
  let lineCount = 1;
  for (let index = 0; index < offset; index += 1) {
    if (source[index] === '\n') {
      lineCount += 1;
    }
  }
  return offset + lineCount * indentation.length;
}

function getCaretLine(source: string, position: number): { content: string; line: number } {
  let line = 0;
  let lineStart = 0;
  for (let index = 0; index < position; index += 1) {
    if (source[index] === '\n') {
      line += 1;
      lineStart = index + 1;
    }
  }
  return { content: source.slice(lineStart, position), line };
}

function validateProjection(
  source: string,
  sourceProjection: EditableSourceProjection | undefined,
): EditableSourceProjection | undefined {
  if (
    !sourceProjection ||
    sourceProjection.start < 0 ||
    sourceProjection.end < sourceProjection.start ||
    sourceProjection.end > source.length ||
    source.slice(sourceProjection.start, sourceProjection.end) !== sourceProjection.source
  ) {
    return undefined;
  }
  return sourceProjection;
}

/** Textarea editor adapter with projection patching and asynchronous highlighting. */
export function CodeEditor({
  source,
  sourceProjection,
  sourceHighlight,
  expanded = false,
  fileName,
  displayFileName,
  language,
  className,
  fallback,
  setSource,
  onActivate,
  onBoundary,
  onExit,
  onReady,
}: CodeEditorProps) {
  const parser = useCodeContext();
  const { ensureParseSourceWorker, loadSourceParser, parseSource, parseSourceAsync } = parser;
  const parserRef = React.useRef(parser);
  React.useLayoutEffect(() => {
    parserRef.current = parser;
  }, [parser]);
  const precomputed = sourceHighlight !== undefined;

  const [edit, setEdit] = React.useState<{
    value: string;
    file: string;
    language: string | undefined;
    expanded: boolean;
  } | null>(null);
  const parseFileName = displayFileName ?? fileName ?? 'code.txt';
  const grammarScope = resolveGrammarScope(parseFileName, language);
  const grammarScopes = React.useMemo(() => (grammarScope ? [grammarScope] : []), [grammarScope]);
  const grammarsReady = useGrammarsReady(grammarScopes, !precomputed && Boolean(loadSourceParser));
  useDemandSourceParser(loadSourceParser, !precomputed && !parseSource);
  const editableProjection = React.useMemo(
    () =>
      typeof source === 'string' ? validateProjection(source, sourceProjection) : sourceProjection,
    [source, sourceProjection],
  );

  const sourceValue = React.useMemo(
    () => getEditorValue(source, editableProjection, expanded),
    [source, editableProjection, expanded],
  );

  const [value, setValue] = React.useState(sourceValue);
  const deferredValue = React.useDeferredValue(value);
  const [highlighted, setHighlighted] = React.useState<{
    source: string;
    fileName: string;
    language: string | undefined;
    hast: HastRoot;
  } | null>(null);
  const highlightedNode = React.useMemo(
    () => (highlighted ? hastToJsx(highlighted.hast) : null),
    [highlighted],
  );
  const rootRef = React.useRef<HTMLDivElement>(null);
  const editorRef = React.useRef<React.ComponentRef<typeof Editor>>(null);
  const inputId = React.useId();

  const original = React.useRef<{
    source: EditorSource;
    projection?: EditableSourceProjection;
    text?: string;
  }>({ source, projection: editableProjection });
  const lastEmittedSourceRef = React.useRef<string | null>(null);
  const projected = !expanded && Boolean(editableProjection);

  const previousIdentityRef = React.useRef({
    fileName,
    parseFileName,
    projected,
    value: sourceValue,
  });

  React.useLayoutEffect(() => {
    const textarea = rootRef.current?.querySelector('textarea');
    if (!textarea) {
      return;
    }
    textarea.tabIndex = -1;
    textarea.setAttribute('aria-label', fileName ? `Edit ${fileName}` : 'Edit code');
    onReady?.(textarea);
  }, [fileName, onReady]);

  React.useLayoutEffect(() => {
    const previous = previousIdentityRef.current;

    const scopeChanged =
      previous.fileName !== fileName ||
      previous.parseFileName !== parseFileName ||
      previous.projected !== projected;

    previousIdentityRef.current = { fileName, parseFileName, projected, value: sourceValue };
    original.current = { source, projection: editableProjection };

    if (scopeChanged && editorRef.current) {
      const textarea = rootRef.current?.querySelector('textarea');
      const selectionStart = Math.min(textarea?.selectionStart ?? 0, sourceValue.length);
      const selectionEnd = Math.min(textarea?.selectionEnd ?? selectionStart, sourceValue.length);

      // A projected undo record would replace the entire file after expanding.
      editorRef.current.session = {
        history: {
          stack: [{ value: sourceValue, selectionStart, selectionEnd, timestamp: 0 }],
          offset: 0,
        },
      };
    }

    if (
      scopeChanged ||
      (previous.value !== sourceValue && source !== lastEmittedSourceRef.current)
    ) {
      setValue(sourceValue);
    }
  }, [source, sourceValue, editableProjection, projected, fileName, parseFileName]);

  React.useEffect(() => {
    if (precomputed || (!parseSourceAsync && !parseSource) || !grammarsReady) {
      return undefined;
    }

    const abortController = new AbortController();
    const highlight = async () => {
      try {
        if (grammarScope) {
          await ensureParseSourceWorker?.([grammarScope]);
        }
        let hast: HastRoot;
        if (parseSourceAsync) {
          hast = await parseSourceAsync(
            deferredValue,
            parseFileName,
            language,
            abortController.signal,
          );
        } else if (parseSource) {
          hast = parseSource(deferredValue, parseFileName, language);
        } else {
          return;
        }
        if (!abortController.signal.aborted) {
          React.startTransition(() => {
            setHighlighted({ source: deferredValue, fileName: parseFileName, language, hast });
          });
        }
      } catch {
        // Keep the editor usable as plain text if highlighting fails.
      }
    };
    void highlight();
    return () => abortController.abort();
  }, [
    precomputed,
    deferredValue,
    parseFileName,
    language,
    grammarScope,
    grammarsReady,
    ensureParseSourceWorker,
    parseSource,
    parseSourceAsync,
  ]);

  React.useEffect(() => {
    if (
      !edit ||
      edit.file !== parseFileName ||
      edit.language !== language ||
      edit.expanded !== expanded
    ) {
      return undefined;
    }

    const controller = new AbortController();

    const highlightEdit = async () => {
      const runtime = parserRef.current;
      const scopes = grammarScope ? [grammarScope] : [];

      const worker =
        (scopes.length ? await runtime.ensureParseSourceWorker?.(scopes) : undefined) ??
        runtime.parseSourceAsync;

      if (controller.signal.aborted) {
        return;
      }

      let hast;

      if (worker) {
        hast = await worker(edit.value, parseFileName, language, controller.signal);
      } else {
        if (runtime.loadSourceParser && scopes.length) {
          await ensureGrammars(scopes);
        }

        const parse = runtime.parseSource ?? (await runtime.loadSourceParser?.());

        if (!parse || controller.signal.aborted) {
          return;
        }

        hast = parse(edit.value, parseFileName, language);
      }

      if (!controller.signal.aborted) {
        React.startTransition(() =>
          setHighlighted({ source: edit.value, fileName: parseFileName, language, hast }),
        );
      }
    };

    void highlightEdit().catch(() => {});

    return () => controller.abort();
  }, [edit, parseFileName, grammarScope, language, expanded]);

  const handleValueChange = React.useCallback(
    (nextValue: string) => {
      if (!setSource) {
        return;
      }
      setValue(nextValue);

      if (precomputed) {
        onActivate?.();
        setEdit({ value: nextValue, file: parseFileName, language, expanded });
      }
      const indentation = !expanded ? editableProjection?.indentation : undefined;
      const canonicalValue = restoreProjectionIndentation(nextValue, indentation);
      const initial = original.current;
      const projected = !expanded && initial.projection;
      const complete = projected ? (initial.text ??= readSource(initial.source)) : '';
      const prefix = projected ? complete.slice(0, projected.start) : '';
      const suffix = projected ? complete.slice(projected.end) : '';
      const nextSource =
        !expanded && editableProjection ? `${prefix}${canonicalValue}${suffix}` : canonicalValue;
      lastEmittedSourceRef.current = nextSource;

      const textarea = rootRef.current?.querySelector('textarea');
      const selectionStart = textarea?.selectionStart ?? nextValue.length;
      const selectionEnd = textarea?.selectionEnd ?? selectionStart;
      const canonicalSelectionStart = toCanonicalProjectionOffset(
        nextValue,
        selectionStart,
        indentation,
      );
      const canonicalSelectionEnd = toCanonicalProjectionOffset(
        nextValue,
        selectionEnd,
        indentation,
      );
      const sourcePosition =
        !expanded && editableProjection
          ? prefix.length + canonicalSelectionStart
          : canonicalSelectionStart;
      const caretLine = getCaretLine(nextSource, sourcePosition);
      React.startTransition(() => {
        setSource(
          nextSource,
          fileName,
          {
            position: sourcePosition,
            extent: canonicalSelectionEnd - canonicalSelectionStart,
            ...caretLine,
          },
          undefined,
          !expanded && editableProjection
            ? {
                source: canonicalValue,
                start: editableProjection.start,
                end: editableProjection.start + canonicalValue.length,
                indentation: editableProjection.indentation,
              }
            : undefined,
        );
      });
    },
    [
      expanded,
      editableProjection,
      setSource,
      fileName,
      precomputed,
      onActivate,
      parseFileName,
      language,
    ],
  );

  const handleKeyDown = React.useCallback(
    (event: React.KeyboardEvent<HTMLElement>) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onExit?.();
        return;
      }
      if (
        expanded ||
        !editableProjection ||
        event.shiftKey ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey
      ) {
        return;
      }
      const textarea = rootRef.current?.querySelector('textarea');
      if (!textarea || textarea.selectionStart !== textarea.selectionEnd) {
        return;
      }
      const atStart = textarea.selectionStart === 0;
      const atEnd = textarea.selectionEnd === textarea.value.length;
      if (
        ((event.key === 'ArrowUp' || event.key === 'ArrowLeft' || event.key === 'PageUp') &&
          atStart) ||
        ((event.key === 'ArrowDown' || event.key === 'ArrowRight' || event.key === 'PageDown') &&
          atEnd)
      ) {
        onBoundary?.();
      }
    },
    [expanded, editableProjection, onBoundary, onExit],
  );

  const parserPending = !parseSource && Boolean(loadSourceParser);
  const grammarPending = Boolean(parseSource && grammarScope && !grammarsReady);

  if (!precomputed && fallback && (parserPending || grammarPending)) {
    return fallback;
  }

  return (
    <div ref={rootRef} className="editable-code-editor">
      <Editor
        ref={editorRef}
        textareaId={inputId}
        readOnly={!setSource}
        ignoreTabKey={!setSource}
        value={value}
        onValueChange={handleValueChange}
        highlight={(currentValue) => {
          let content: React.ReactNode;

          const edited =
            edit?.value === currentValue &&
            edit.file === parseFileName &&
            edit.language === language &&
            edit.expanded === expanded;

          if (precomputed && !edited) {
            return sourceHighlight;
          }
          if (
            highlighted?.source === currentValue &&
            highlighted.fileName === parseFileName &&
            highlighted.language === language
          ) {
            content = highlightedNode;
          } else if (!precomputed && parseSource && grammarsReady) {
            content = hastToJsx(parseSource(currentValue, parseFileName, language));
          } else {
            content = currentValue;
          }
          return <code className={language ? `language-${language}` : undefined}>{content}</code>;
        }}
        tabSize={2}
        insertSpaces
        preClassName={className}
        textareaClassName="editable-code-textarea"
        onFocus={onActivate}
        onKeyDown={handleKeyDown}
      />
      {precomputed && (
        <label hidden htmlFor={inputId}>
          {fileName ? `Edit ${fileName}` : 'Edit code'}
        </label>
      )}
    </div>
  );
}
