import { StreamLanguage } from '@codemirror/language';
import { diff as diffMode } from '@codemirror/legacy-modes/mode/diff';
import { shell as shellMode } from '@codemirror/legacy-modes/mode/shell';
import type { Parser } from '@lezer/common';
import { parser as cssParser } from '@lezer/css';
import { highlightCode, tagHighlighter, tags } from '@lezer/highlight';
import { configureNesting, parser as htmlParser } from '@lezer/html';
import { parser as jsParser } from '@lezer/javascript';
import { parser as jsonParser } from '@lezer/json';
import { GFM, parseCode, parser as markdownParser } from '@lezer/markdown';
import { parser as yamlParser } from '@lezer/yaml';
import type { Categorize } from '../engine';
import type { Token } from '../hast';
import type { Language } from '../languages';

/**
 * `classHighlighter` folds tag names into types and has no class for function
 * names or attributes, so map the tags docs-infra distinguishes explicitly.
 * The most specific matching tag wins.
 */
const highlighter = tagHighlighter([
  { tag: tags.comment, class: 'cm-comment' },
  { tag: [tags.string, tags.docString, tags.character], class: 'cm-string' },
  { tag: [tags.regexp, tags.escape, tags.special(tags.string)], class: 'cm-string2' },
  { tag: tags.keyword, class: 'cm-keyword' },
  { tag: [tags.operatorKeyword, tags.controlKeyword, tags.definitionKeyword], class: 'cm-keyword' },
  { tag: tags.moduleKeyword, class: 'cm-keyword' },
  { tag: tags.number, class: 'cm-number' },
  { tag: [tags.bool, tags.null, tags.atom, tags.unit], class: 'cm-atom' },
  { tag: tags.constant(tags.name), class: 'cm-constant' },
  { tag: tags.standard(tags.name), class: 'cm-builtin' },
  {
    tag: [
      tags.function(tags.variableName),
      tags.function(tags.propertyName),
      tags.function(tags.definition(tags.variableName)),
    ],
    class: 'cm-function',
  },
  { tag: [tags.typeName, tags.className, tags.namespace], class: 'cm-type' },
  { tag: tags.tagName, class: 'cm-tagName' },
  { tag: tags.angleBracket, class: 'cm-angleBracket' },
  { tag: tags.attributeName, class: 'cm-attributeName' },
  { tag: tags.propertyName, class: 'cm-propertyName' },
  { tag: [tags.variableName, tags.labelName, tags.self], class: 'cm-variableName' },
  { tag: [tags.punctuation, tags.operator], class: 'cm-punctuation' },
  { tag: tags.monospace, class: 'cm-monospace' },
  {
    tag: [
      tags.heading,
      tags.emphasis,
      tags.strong,
      tags.link,
      tags.url,
      tags.contentSeparator,
      tags.processingInstruction,
    ],
    class: 'cm-markup',
  },
  { tag: tags.inserted, class: 'cm-inserted' },
  { tag: tags.deleted, class: 'cm-deleted' },
  { tag: tags.meta, class: 'cm-meta' },
  { tag: tags.invalid, class: 'cm-invalid' },
]);

const CATEGORY_BY_CLASS: Record<string, ReturnType<Categorize>> = {
  'cm-comment': 'comment',
  'cm-string': 'string',
  'cm-string2': 'string',
  'cm-keyword': 'keyword',
  'cm-number': 'number',
  'cm-atom': 'constant',
  'cm-constant': 'constant',
  'cm-builtin': 'constant',
  'cm-monospace': 'constant',
  'cm-function': 'function',
  'cm-type': 'type',
  'cm-tagName': 'tag',
  'cm-angleBracket': 'punctuation',
  'cm-attributeName': 'attribute',
  'cm-propertyName': 'property',
  'cm-variableName': 'variable',
  'cm-punctuation': 'punctuation',
  'cm-markup': 'markup',
  'cm-inserted': 'inserted',
  'cm-deleted': 'deleted',
};

export const categorizeCodemirror: Categorize = (className, _text, language) => {
  // Lezer tags CSS class and pseudo-class selectors as class names.
  if (className === 'cm-type' && language === 'css') {
    return 'tag';
  }
  return CATEGORY_BY_CLASS[className] ?? 'other';
};

const js = jsParser.configure({ dialect: 'jsx' });
const ts = jsParser.configure({ dialect: 'ts' });
const tsx = jsParser.configure({ dialect: 'ts jsx' });
const html = htmlParser.configure({
  wrap: configureNesting([
    { tag: 'script', parser: js },
    { tag: 'style', parser: cssParser },
  ]),
});
const shell = StreamLanguage.define(shellMode).parser;
const diff = StreamLanguage.define(diffMode).parser;

const FENCE_PARSERS: Record<string, Parser> = {
  js,
  javascript: js,
  jsx: js,
  ts,
  typescript: ts,
  tsx,
  json: jsonParser,
  css: cssParser,
  html,
  yaml: yamlParser,
  yml: yamlParser,
  sh: shell,
  bash: shell,
  shell,
  diff,
};
const codeParser = (info: string) => FENCE_PARSERS[info.trim().split(/\s/)[0]] ?? null;
const markdown = markdownParser.configure([GFM, parseCode({ codeParser, htmlParser: html })]);
// No Lezer grammar exists for MDX: JSX blocks go through the TSX parser, but
// `import`/`export` lines and `{expressions}` stay Markdown paragraphs.
const mdx = markdownParser.configure([GFM, parseCode({ codeParser, htmlParser: tsx })]);

const PARSERS: Record<Language, Parser> = {
  js,
  ts,
  tsx,
  json: jsonParser,
  md: markdown,
  mdx,
  html,
  css: cssParser,
  sh: shell,
  yaml: yamlParser,
  diff,
};

/** Highlights `source` with the Lezer parser for `language`, one token array per line. */
export function tokenizeCodemirror(source: string, language: Language): Token[][] {
  const lines: Token[][] = [[]];
  highlightCode(
    source,
    PARSERS[language].parse(source),
    highlighter,
    (text, classes) => {
      lines[lines.length - 1].push({ text, className: classes || undefined });
    },
    () => {
      lines.push([]);
    },
  );
  return lines;
}
