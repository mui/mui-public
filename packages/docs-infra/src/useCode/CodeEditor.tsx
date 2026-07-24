'use client';

import * as React from 'react';
import EditorImport from 'react-simple-code-editor';
import type { EditableSourceProjection, HastRoot } from '../CodeHighlighter/types';
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

export interface CodeEditorProps {
  source: string;
  sourceProjection?: EditableSourceProjection;
  expanded?: boolean;
  fileName?: string;
  displayFileName?: string;
  language?: string;
  className?: string;
  fallback?: React.ReactNode;
  setSource: SetSource;
  onActivate?: () => void;
  onBoundary?: () => void;
  onExit?: () => void;
  onReady?: (textarea: HTMLTextAreaElement) => void;
}

function getEditorValue(
  source: string,
  sourceProjection: EditableSourceProjection | undefined,
  expanded: boolean,
): string {
  if (expanded || !sourceProjection) {
    return source;
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
  const { ensureParseSourceWorker, sourceParser, parseSource, parseSourceAsync } = useCodeContext();
  const parseFileName = displayFileName ?? fileName ?? 'code.txt';
  const grammarScope = resolveGrammarScope(parseFileName, language);
  const grammarScopes = React.useMemo(() => (grammarScope ? [grammarScope] : []), [grammarScope]);
  const grammarsReady = useGrammarsReady(grammarScopes, Boolean(sourceParser));
  useDemandSourceParser(sourceParser, !parseSource);
  const editableProjection = React.useMemo(
    () => validateProjection(source, sourceProjection),
    [source, sourceProjection],
  );
  const [value, setValue] = React.useState(() =>
    getEditorValue(source, editableProjection, expanded),
  );
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
  const prefixRef = React.useRef(
    editableProjection ? source.slice(0, editableProjection.start) : '',
  );
  const suffixRef = React.useRef(editableProjection ? source.slice(editableProjection.end) : '');
  const lastEmittedSourceRef = React.useRef<string | null>(null);
  const previousIdentityRef = React.useRef({
    fileName,
    displayFileName,
    expanded,
    sourceProjection: editableProjection,
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

  React.useEffect(() => {
    const previous = previousIdentityRef.current;
    const identityChanged =
      previous.fileName !== fileName ||
      previous.displayFileName !== displayFileName ||
      previous.expanded !== expanded ||
      previous.sourceProjection !== editableProjection;
    previousIdentityRef.current = {
      fileName,
      displayFileName,
      expanded,
      sourceProjection: editableProjection,
    };

    if (!identityChanged && source === lastEmittedSourceRef.current) {
      return;
    }

    prefixRef.current = editableProjection ? source.slice(0, editableProjection.start) : '';
    suffixRef.current = editableProjection ? source.slice(editableProjection.end) : '';
    setValue(getEditorValue(source, editableProjection, expanded));
  }, [source, editableProjection, expanded, fileName, displayFileName]);

  React.useEffect(() => {
    if ((!parseSourceAsync && !parseSource) || !grammarsReady) {
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
    deferredValue,
    parseFileName,
    language,
    grammarScope,
    grammarsReady,
    ensureParseSourceWorker,
    parseSource,
    parseSourceAsync,
  ]);

  const handleValueChange = React.useCallback(
    (nextValue: string) => {
      setValue(nextValue);
      const indentation = !expanded ? editableProjection?.indentation : undefined;
      const canonicalValue = restoreProjectionIndentation(nextValue, indentation);
      const nextSource =
        !expanded && editableProjection
          ? `${prefixRef.current}${canonicalValue}${suffixRef.current}`
          : canonicalValue;
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
          ? prefixRef.current.length + canonicalSelectionStart
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
    [expanded, editableProjection, setSource, fileName],
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

  const parserPending = !parseSource && Boolean(sourceParser);
  const grammarPending = Boolean(parseSource && grammarScope && !grammarsReady);
  if (fallback && (parserPending || grammarPending)) {
    return fallback;
  }

  return (
    <div ref={rootRef} className="editable-code-editor">
      <Editor
        value={value}
        onValueChange={handleValueChange}
        highlight={(currentValue) => {
          let content: React.ReactNode;
          if (
            highlighted?.source === currentValue &&
            highlighted.fileName === parseFileName &&
            highlighted.language === language
          ) {
            content = highlightedNode;
          } else if (parseSource && grammarsReady) {
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
    </div>
  );
}
