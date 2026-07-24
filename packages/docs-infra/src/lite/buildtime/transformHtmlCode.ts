import type { Element, Root, RootContent } from 'hast';
import { visit } from 'unist-util-visit';
import { parseSource, parseSourceInline, splitFocusFrameRange } from '../shared/syntax/parseSource';

const DEFAULT_FOCUS_FRAMES_MAX_SIZE = 60;
const RESERVED_DATA_PROPS = new Set([
  'dataFilename',
  'dataVariant',
  'dataTransform',
  'dataPrecompute',
  'dataContentProps',
  'dataName',
  'dataSlug',
  'dataDisplayComments',
]);

export interface TransformHtmlCodeOptions {
  /** Maximum number of lines retained in an explicit focus frame. @default 60 */
  focusFramesMaxSize?: number;
}

function textContent(node: RootContent): string {
  if (node.type === 'text') {
    return node.value;
  }
  if ('children' in node) {
    return node.children.map((child) => textContent(child)).join('');
  }
  return '';
}

function languageOf(code: Element): string | undefined {
  const className = code.properties.className;
  const classes = Array.isArray(className) ? className : [className];
  const languageClass = classes.find(
    (value): value is string => typeof value === 'string' && value.startsWith('language-'),
  );
  return languageClass?.slice('language-'.length);
}

function userPropsOf(code: Element): Record<string, string | boolean> | undefined {
  const userProps: Record<string, string | boolean> = {};
  for (const [key, value] of Object.entries(code.properties)) {
    if (!key.startsWith('data') || key.length <= 4 || RESERVED_DATA_PROPS.has(key)) {
      continue;
    }
    const name = key.charAt(4).toLowerCase() + key.slice(5);
    if (name === 'collapseToEmpty' || name === 'initialExpanded') {
      if (value === true || value === 'true' || value === '') {
        userProps[name] = true;
      } else if (value === false || value === 'false') {
        userProps[name] = false;
      }
    } else {
      userProps[name] = String(value);
    }
  }
  return Object.keys(userProps).length > 0 ? userProps : undefined;
}

function stripJsxExpressionSemicolon(source: string): string {
  if (source.endsWith('>;\n')) {
    return source.slice(0, -2);
  }
  return source.endsWith('>;') ? source.slice(0, -1) : source;
}

/** Highlights fenced and inline MDX code with the lite Lezer syntax parser. */
export function transformHtmlCode(options: TransformHtmlCodeOptions = {}) {
  const focusFramesMaxSize = Math.max(
    1,
    options.focusFramesMaxSize ?? DEFAULT_FOCUS_FRAMES_MAX_SIZE,
  );

  return (tree: Root): void => {
    visit(tree, 'element', (pre: Element) => {
      if (pre.tagName !== 'pre' || pre.properties.dataPrecompute !== undefined) {
        return;
      }
      const code = pre.children.find(
        (child): child is Element => child.type === 'element' && child.tagName === 'code',
      );
      if (!code) {
        return;
      }

      const language = languageOf(code);
      const fileName =
        typeof code.properties.dataFilename === 'string' ? code.properties.dataFilename : undefined;
      let source = code.children.map((child) => textContent(child)).join('');
      if (language === 'jsx' || language === 'tsx') {
        source = stripJsxExpressionSemicolon(source);
      }

      const highlighted = parseSource(source, fileName, language, {
        emphasis: code.properties.dataDisplayComments !== 'true',
      });
      const focusRange = highlighted.data.focusRange;
      const focusEnd = focusRange
        ? Math.min(focusRange.end, focusRange.start + focusFramesMaxSize - 1)
        : highlighted.data.totalLines;
      const focusedLines = focusRange ? focusEnd - focusRange.start + 1 : focusEnd;
      const collapsible = focusedLines < highlighted.data.totalLines;
      const framed = focusRange
        ? splitFocusFrameRange(highlighted, focusRange.start, focusEnd)
        : highlighted;
      const precomputedSource = {
        ...framed,
        data: { ...framed.data, focusedLines, collapsible },
      };
      const variant = {
        source: precomputedSource,
        ...(language ? { language } : {}),
        ...(fileName ? { fileName } : {}),
        totalLines: highlighted.data.totalLines,
        focusedLines,
        collapsible,
      };

      pre.children = [
        {
          type: 'text',
          value:
            'Error: expected pre tag with precomputed data to be handled by the CodeHighlighter component',
        },
      ];
      pre.properties.dataPrecompute = JSON.stringify({ Default: variant });
      if (code.properties.dataName) {
        pre.properties.dataName = code.properties.dataName;
      }
      if (code.properties.dataSlug) {
        pre.properties.dataSlug = code.properties.dataSlug;
      }
      const userProps = userPropsOf(code);
      if (userProps) {
        pre.properties.dataContentProps = JSON.stringify(userProps);
      }
    });

    visit(tree, 'element', (code: Element, index, parent) => {
      if (
        code.tagName !== 'code' ||
        (parent?.type === 'element' && parent.tagName === 'pre') ||
        code.children.length === 0
      ) {
        return;
      }
      const language = languageOf(code);
      if (!language) {
        return;
      }
      const source = code.children.map((child) => textContent(child)).join('');
      if (!source) {
        return;
      }
      const highlighted = parseSourceInline(source, language);
      if (!highlighted) {
        return;
      }
      code.children = highlighted;
      code.properties.dataInline = '';
    });
  };
}

export default transformHtmlCode;
