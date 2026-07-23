import { highlightTree, tagHighlighter, styleTags, tags } from '@lezer/highlight';
import type { Highlighter } from '@lezer/highlight';
import type { SyntaxNode, Tree } from '@lezer/common';
import { parser as jsParser } from '@lezer/javascript';
import { parser as cssParser } from '@lezer/css';
import { parser as jsonParser } from '@lezer/json';

/** Grammar setup, class mapping, and tokenization for parseSource. */

export interface Token {
  text: string;
  classes: string;
  /** Set by `@highlight-text` splitting and rendered inside a `<mark>`. */
  mark?: boolean;
}

interface ClassFixup {
  from: number;
  to: number;
  classes: string;
}

export interface Language {
  parser: { parse(source: string): Tree };
  highlighter: Highlighter;
  fixups?: (tree: Tree) => ClassFixup[];
  commentNodes?: Set<string>;
  jsx?: boolean;
}

export const BUILT_IN_TYPES = new Set([
  'string',
  'number',
  'boolean',
  'void',
  'never',
  'symbol',
  'object',
  'any',
  'unknown',
  'bigint',
]);

const TYPE_NAME = 'lz-type';
const TAG_NAME = 'lz-tag';

const jsExtraStyles = styleTags({
  'ParamList/VariableDefinition ArrowFunction/VariableDefinition': tags.special(
    tags.definition(tags.variableName),
  ),
  'ImportGroup/VariableDefinition ImportDeclaration/VariableDefinition': tags.special(
    tags.variableName,
  ),
  Spread: tags.controlOperator,
});
const jsBase = jsParser.configure({ props: [jsExtraStyles] });

export const jsHighlighter = tagHighlighter([
  { tag: tags.comment, class: 'pl-c' },
  { tag: tags.string, class: 'pl-s' },
  { tag: tags.special(tags.string), class: 'pl-s' },
  { tag: tags.regexp, class: 'pl-sr' },
  { tag: tags.escape, class: 'pl-cce' },
  { tag: tags.number, class: 'pl-c1 pl-num' },
  { tag: tags.bool, class: 'pl-c1 pl-bool' },
  { tag: tags.null, class: 'pl-c1 pl-n' },
  { tag: tags.atom, class: 'pl-c1' },
  { tag: tags.keyword, class: 'pl-k' },
  { tag: tags.self, class: 'pl-c1 pl-this' },
  { tag: tags.typeName, class: TYPE_NAME },
  { tag: tags.className, class: 'pl-en' },
  { tag: tags.propertyName, class: 'pl-c1' },
  { tag: tags.variableName, class: 'pl-smi' },
  { tag: tags.special(tags.variableName), class: 'pl-smi' },
  { tag: tags.definition(tags.variableName), class: 'pl-c1' },
  { tag: tags.special(tags.definition(tags.variableName)), class: 'pl-v' },
  { tag: tags.function(tags.variableName), class: 'pl-en' },
  { tag: tags.function(tags.definition(tags.variableName)), class: 'pl-en' },
  { tag: tags.function(tags.propertyName), class: 'pl-en' },
  { tag: tags.arithmeticOperator, class: 'pl-k pl-pu' },
  { tag: tags.logicOperator, class: 'pl-k pl-pu' },
  { tag: tags.bitwiseOperator, class: 'pl-k pl-pu' },
  { tag: tags.compareOperator, class: 'pl-k pl-pu' },
  { tag: tags.updateOperator, class: 'pl-k pl-pu' },
  { tag: tags.definitionOperator, class: 'pl-k pl-pu' },
  { tag: tags.typeOperator, class: 'pl-k pl-pu' },
  { tag: tags.controlOperator, class: 'pl-k pl-pu' },
  { tag: tags.function(tags.punctuation), class: 'pl-k pl-pu' },
  { tag: tags.tagName, class: TAG_NAME },
  { tag: tags.attributeName, class: 'pl-ak' },
  { tag: tags.attributeValue, class: 'pl-s pl-av' },
  { tag: tags.angleBracket, class: 'pl-jsx' },
]);

const cssExtraStyles = styleTags({ AttributeName: tags.attributeName });
const cssBase = cssParser.configure({ props: [cssExtraStyles] });

const cssHighlighter = tagHighlighter([
  { tag: tags.comment, class: 'pl-c' },
  { tag: tags.string, class: 'pl-s' },
  { tag: tags.propertyName, class: 'pl-cp' },
  { tag: tags.variableName, class: 'pl-v' },
  { tag: tags.tagName, class: 'pl-ent' },
  { tag: tags.className, class: 'pl-e' },
  { tag: tags.constant(tags.className), class: 'pl-e' },
  { tag: tags.attributeName, class: 'pl-e pl-da' },
  { tag: tags.definitionOperator, class: 'pl-ent' },
  { tag: tags.logicOperator, class: 'pl-k' },
  { tag: tags.compareOperator, class: 'pl-k' },
  { tag: tags.definitionKeyword, class: 'pl-k' },
  { tag: tags.number, class: 'pl-c1 pl-num' },
  { tag: tags.unit, class: 'pl-k' },
  { tag: tags.atom, class: 'pl-c1 pl-cv' },
  { tag: tags.keyword, class: 'pl-c1 pl-cv' },
  { tag: tags.color, class: 'pl-c1' },
]);

const jsonHighlighter = tagHighlighter([
  { tag: tags.propertyName, class: 'pl-ent' },
  { tag: tags.string, class: 'pl-s' },
  { tag: tags.number, class: 'pl-c1 pl-num' },
  { tag: tags.bool, class: 'pl-c1 pl-bool' },
  { tag: tags.null, class: 'pl-c1 pl-n' },
]);

const jsCommentNodes = new Set(['LineComment', 'BlockComment']);
const cssCommentNodes = new Set(['Comment']);

export const LANGUAGES: Record<string, Language> = {
  js: {
    parser: jsBase,
    highlighter: jsHighlighter,
    fixups: jsTreeFixups,
    commentNodes: jsCommentNodes,
  },
  ts: {
    parser: jsBase.configure({ dialect: 'ts' }),
    highlighter: jsHighlighter,
    fixups: jsTreeFixups,
    commentNodes: jsCommentNodes,
  },
  tsx: {
    parser: jsBase.configure({ dialect: 'jsx ts' }),
    highlighter: jsHighlighter,
    fixups: jsTreeFixups,
    commentNodes: jsCommentNodes,
    jsx: true,
  },
  css: { parser: cssBase, highlighter: cssHighlighter, commentNodes: cssCommentNodes },
  json: { parser: jsonParser, highlighter: jsonHighlighter },
};
LANGUAGES.jsx = LANGUAGES.tsx;
LANGUAGES.javascript = LANGUAGES.js;
LANGUAGES.typescript = LANGUAGES.ts;
LANGUAGES.mjs = LANGUAGES.js;
LANGUAGES.cjs = LANGUAGES.js;
LANGUAGES.mts = LANGUAGES.ts;
LANGUAGES.cts = LANGUAGES.ts;

function specializeClasses(classes: string, text: string): string {
  if (classes === TYPE_NAME) {
    return BUILT_IN_TYPES.has(text) ? 'pl-c1 pl-bt' : 'pl-en';
  }
  if (classes === TAG_NAME) {
    return /^[a-z]/.test(text) ? 'pl-ent pl-ht' : 'pl-jt';
  }
  return classes;
}

export function languageFromFileName(fileName?: string): string | undefined {
  const extension = /\.([a-z0-9]+)$/i.exec(fileName || '');
  return extension ? extension[1].toLowerCase() : undefined;
}

const PATTERN_NODES = new Set(['ObjectPattern', 'ArrayPattern', 'PatternProperty']);

function collectParamPatternFixups(pattern: SyntaxNode, fixups: ClassFixup[]): void {
  for (let child = pattern.firstChild; child; child = child.nextSibling) {
    if (child.name === 'PropertyName' || child.name === 'VariableDefinition') {
      fixups.push({ from: child.from, to: child.to, classes: 'pl-v' });
    } else if (PATTERN_NODES.has(child.name)) {
      collectParamPatternFixups(child, fixups);
    }
  }
}

function jsTreeFixups(tree: Tree): ClassFixup[] {
  const fixups: ClassFixup[] = [];
  tree.iterate({
    enter(node) {
      if (
        (node.name === 'ObjectPattern' || node.name === 'ArrayPattern') &&
        node.node.parent?.name === 'ParamList'
      ) {
        collectParamPatternFixups(node.node, fixups);
        return false;
      }
      if (node.name === 'JSXAttribute') {
        const equals = node.node.getChild('Equals');
        if (equals) {
          fixups.push({ from: equals.from, to: equals.to, classes: 'pl-k pl-ae' });
        }
      } else if (node.name === 'JSXMemberExpression') {
        for (let child = node.node.firstChild; child; child = child.nextSibling) {
          if (child.name === 'JSXIdentifier' || child.name === '.') {
            fixups.push({ from: child.from, to: child.to, classes: 'pl-jt' });
          }
        }
      }
      return undefined;
    },
  });
  return fixups.sort((first, second) => first.from - second.from);
}

function findMatchingAngleBracket(source: string, start: number): number {
  let depth = 0;
  for (let index = start; index < source.length; index += 1) {
    const char = source[index];
    if (char === '\n') {
      return -1;
    }
    if (char === '<') {
      depth += 1;
    } else if (char === '>' && source[index - 1] !== '=') {
      depth -= 1;
      if (depth === 0) {
        return index + 1;
      }
    }
  }
  return -1;
}

/** Recovers JSX generic type arguments that Lezer currently misparses. */
export function findJsxGenericTypeArgRanges(
  source: string,
  lang: Language,
): Array<{ from: number; to: number }> {
  if (!lang.jsx) {
    return [];
  }
  const ranges: Array<{ from: number; to: number }> = [];
  lang.parser.parse(source).iterate({
    enter(node) {
      if (node.name !== 'JSXMemberExpression' && node.name !== 'JSXIdentifier') {
        return;
      }
      const parent = node.node.parent;
      if (
        parent &&
        parent.to === node.to &&
        (parent.name === 'JSXSelfClosingTag' || parent.name === 'JSXOpenTag') &&
        source[node.to] === '<'
      ) {
        const end = findMatchingAngleBracket(source, node.to);
        if (end !== -1) {
          ranges.push({ from: node.to, to: end });
        }
      }
    },
  });
  return ranges;
}

/** Highlights source into flat tokens that cover the complete source. */
export function tokenize(source: string, lang: Language): Token[] {
  const tree = lang.parser.parse(source);
  const fixups = lang.fixups ? lang.fixups(tree) : [];
  let fixupIndex = 0;
  const tokens: Token[] = [];

  const pushPlain = (from: number, to: number) => {
    let cursor = from;
    while (fixupIndex < fixups.length && fixups[fixupIndex].from < to) {
      const fixup = fixups[fixupIndex];
      if (fixup.from < cursor) {
        fixupIndex += 1;
        continue;
      }
      if (fixup.to > to) {
        break;
      }
      if (fixup.from > cursor) {
        tokens.push({ text: source.slice(cursor, fixup.from), classes: '' });
      }
      tokens.push({ text: source.slice(fixup.from, fixup.to), classes: fixup.classes });
      cursor = fixup.to;
      fixupIndex += 1;
    }
    if (cursor < to) {
      tokens.push({ text: source.slice(cursor, to), classes: '' });
    }
  };

  let position = 0;
  highlightTree(tree, lang.highlighter, (from, to, classes) => {
    if (from > position) {
      pushPlain(position, from);
    }
    while (fixupIndex < fixups.length && fixups[fixupIndex].from < from) {
      fixupIndex += 1;
    }
    const fixup = fixups[fixupIndex];
    const text = source.slice(from, to);
    if (fixup && fixup.from === from && fixup.to === to) {
      tokens.push({ text, classes: fixup.classes });
      fixupIndex += 1;
    } else {
      tokens.push({ text, classes: specializeClasses(classes, text) });
    }
    position = to;
  });
  if (position < source.length) {
    pushPlain(position, source.length);
  }
  return tokens;
}

/** Highlights a JSX generic span by parsing it in a supported call position. */
export function highlightAsTypeArg(typeArgText: string, lang: Language): Token[] {
  const synthetic = `f${typeArgText}()`;
  const tokens = tokenize(synthetic, lang);
  const from = 1;
  const to = 1 + typeArgText.length;
  const sliced: Token[] = [];
  let offset = 0;
  for (const token of tokens) {
    const tokenEnd = offset + token.text.length;
    if (tokenEnd > from && offset < to) {
      const start = Math.max(from, offset);
      const end = Math.min(to, tokenEnd);
      sliced.push({ text: token.text.slice(start - offset, end - offset), classes: token.classes });
    }
    offset = tokenEnd;
  }
  return sliced;
}

export interface TokenReplacement {
  from: number;
  to: number;
  tokens: Token[];
}

/** Replaces absolute token ranges while preserving all surrounding positions. */
export function spliceTokens(tokens: Token[], replacements: TokenReplacement[]): Token[] {
  if (replacements.length === 0) {
    return tokens;
  }
  const result: Token[] = [];
  let replacementIndex = 0;
  let offset = 0;
  for (const token of tokens) {
    const tokenEnd = offset + token.text.length;
    let cursor = offset;
    while (
      replacementIndex < replacements.length &&
      replacements[replacementIndex].from < tokenEnd
    ) {
      const replacement = replacements[replacementIndex];
      const from = Math.max(replacement.from, cursor);
      if (from > cursor) {
        result.push({
          text: token.text.slice(cursor - offset, from - offset),
          classes: token.classes,
        });
      }
      if (from === replacement.from) {
        result.push(...replacement.tokens);
      }
      cursor = Math.min(replacement.to, tokenEnd);
      if (replacement.to > tokenEnd) {
        break;
      }
      replacementIndex += 1;
    }
    if (cursor < tokenEnd) {
      result.push({ text: token.text.slice(cursor - offset), classes: token.classes });
    }
    offset = tokenEnd;
  }
  return result;
}
