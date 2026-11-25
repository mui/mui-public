import * as diff from 'diff';
import type { Parser, Plugin } from 'prettier';
import type { FileContent, PackageContents } from '../packageDownload';
import { getMultilineValueRanges, normalizeSyntax } from './normalizeSyntax';

export type ChangeType = 'added' | 'removed' | 'modified';

export interface DiffOptions {
  ignoreWhitespace: boolean;
  /**
   * Run both sides through Prettier without comments, and print constructs that build tools
   * spell differently, like `void 0` or where `export` goes, one way. What's left are the
   * differences in what the code does.
   */
  normalizeSyntax: boolean;
}

export interface DiffBlock {
  text: string;
  className: string | null;
}

export interface ChangedFile {
  path: string;
  changeType: ChangeType;
}

export interface FileDiffResult extends ChangedFile {
  blocks: DiffBlock[];
  /** Set when normalizing was requested but failed; the diff then shows the raw contents. */
  formatError?: string;
}

const PRETTIER_PARSERS: [RegExp, string][] = [
  [/\.[cm]?jsx?$/, 'babel'],
  [/\.[cm]?tsx?$/, 'typescript'],
  [/\.json$/, 'json'],
  [/\.css$/, 'css'],
];

function getPrettierParser(path: string): string | null {
  return PRETTIER_PARSERS.find(([pattern]) => pattern.test(path))?.[1] ?? null;
}

const NORMALIZED_SUFFIX = '-normalized';

interface AstNode {
  type?: string;
  comments?: unknown[];
  nodes?: AstNode[];
}

// Prettier prints the comments it finds in `ast.comments` (JavaScript, TypeScript, JSON),
// PostCSS keeps them as nodes in the tree instead.
function removeComments(node: AstNode) {
  if (node.comments) {
    node.comments = [];
  }
  if (node.nodes) {
    node.nodes = node.nodes.filter((child) => child.type !== 'css-comment');
    node.nodes.forEach(removeComments);
  }
}

// `keep` holds the spans where a blank line is part of a value, sorted by start
function removeBlankLines(code: string, keep: [number, number][]): string {
  let offset = 0;
  let next = 0;
  return code
    .split('\n')
    .filter((line) => {
      const lineStart = offset;
      offset += line.length + 1;
      if (line.trim() !== '' || offset > code.length) {
        return true;
      }
      while (next < keep.length && keep[next][1] <= lineStart) {
        next += 1;
      }
      return next < keep.length && keep[next][0] < lineStart;
    })
    .join('\n');
}

const BLANK_LINE = /\n[ \t]*\n/;

/**
 * Adds a `<name>-normalized` variant of every parser in `plugins`, whose AST has its syntax
 * normalized and its comments removed before Prettier prints it.
 */
function createNormalizedPlugin(plugins: Plugin[]): Plugin {
  const parsers: Record<string, Parser> = {};
  for (const plugin of plugins) {
    for (const [name, parser] of Object.entries(plugin.parsers ?? {})) {
      parsers[`${name}${NORMALIZED_SUFFIX}`] = {
        ...parser,
        // Prettier keeps a blank line wherever the input had one, and a blank line between
        // object properties keeps the object expanded, so they go before formatting
        preprocess: async (text, options) => {
          const source = parser.preprocess ? await parser.preprocess(text, options) : text;
          if (!BLANK_LINE.test(source)) {
            return source;
          }
          const keep =
            parser.astFormat === 'estree'
              ? getMultilineValueRanges(await parser.parse(source, options))
              : // JSON and CSS strings can't span lines
                [];
          return removeBlankLines(source, keep);
        },
        parse: async (text, options) => {
          const ast = await parser.parse(text, options);
          normalizeSyntax(ast, options.filepath);
          removeComments(ast);
          return ast;
        },
      };
    }
  }
  return { parsers };
}

let prettierPromise: Promise<
  (source: string, parser: string, filepath: string) => Promise<string>
> | null = null;

// Prettier and its parsers are several hundred KB, only load them once normalizing is requested.
function loadPrettier() {
  prettierPromise ??= Promise.all([
    import('prettier/standalone'),
    import('prettier/plugins/babel'),
    import('prettier/plugins/estree'),
    import('prettier/plugins/typescript'),
    import('prettier/plugins/postcss'),
  ]).then(([prettier, ...modules]) => {
    const languagePlugins: Plugin[] = modules;
    const plugins = [...languagePlugins, createNormalizedPlugin(languagePlugins)];
    return (source, parser, filepath) =>
      // By default Prettier keeps an object expanded when the source had a newline after
      // `{`, which would preserve exactly the style differences this is meant to remove.
      prettier.format(source, { parser, plugins, filepath, objectWrap: 'collapse' });
  });
  return prettierPromise;
}

// Keyed by file identity, so diffing the same downloaded package again with other options
// doesn't format its files a second time. The parser follows from the file's path.
const formattedCache = new WeakMap<FileContent, Promise<string>>();

function formatFile(file: FileContent | undefined, parser: string): Promise<string> {
  if (!file) {
    return Promise.resolve('');
  }
  let formatted = formattedCache.get(file);
  if (!formatted) {
    formatted = loadPrettier().then((format) => format(file.content, parser, file.path));
    formattedCache.set(file, formatted);
  }
  return formatted;
}

function getLineClass(line: string): string | null {
  if (line.startsWith('+')) {
    return 'diff-added';
  }
  if (line.startsWith('-')) {
    return 'diff-removed';
  }
  if (line.startsWith('@@')) {
    return 'diff-hunk';
  }
  return null;
}

function createDiffBlocks(
  path: string,
  oldContent: string,
  newContent: string,
  oldHeader: string,
  newHeader: string,
  ignoreWhitespace: boolean,
): DiffBlock[] {
  const patch = diff.createPatch(path, oldContent, newContent, oldHeader, newHeader, {
    ignoreWhitespace,
  });

  const blocks: DiffBlock[] = [];
  // Skip the "Index: <filename>" and "===" lines
  const contentLines = patch.split('\n').slice(2);
  for (let index = 0; index < contentLines.length; index += 1) {
    const line = contentLines[index];
    // The "---" and "+++" file headers
    const className = index < 2 ? 'diff-preamble' : getLineClass(line);
    const text = `${line}\n`;
    const lastBlock = blocks[blocks.length - 1];
    if (lastBlock && lastBlock.className === className) {
      lastBlock.text += text;
    } else {
      blocks.push({ text, className });
    }
  }
  return blocks;
}

export interface PackageDiff {
  /** The files whose raw contents differ, sorted by path. Cheap, available right away. */
  files: ChangedFile[];
  /**
   * The unified diff of one of `files`, or `null` when the file turns out unchanged
   * once formatted.
   */
  diffFile(file: ChangedFile, options: DiffOptions): Promise<FileDiffResult | null>;
}

export function createPackageDiff(
  oldPackage: PackageContents,
  newPackage: PackageContents,
): PackageDiff {
  const oldFiles = new Map(oldPackage.files.map((file) => [file.path, file]));
  const newFiles = new Map(newPackage.files.map((file) => [file.path, file]));
  const allPaths = Array.from(new Set([...oldFiles.keys(), ...newFiles.keys()])).sort();

  const files: ChangedFile[] = [];
  for (const path of allPaths) {
    const oldFile = oldFiles.get(path);
    const newFile = newFiles.get(path);
    if (oldFile?.content === newFile?.content) {
      continue;
    }
    let changeType: ChangeType = 'modified';
    if (!oldFile) {
      changeType = 'added';
    } else if (!newFile) {
      changeType = 'removed';
    }
    files.push({ path, changeType });
  }

  const oldHeader = `${oldPackage.name}@${oldPackage.version}`;
  const newHeader = `${newPackage.name}@${newPackage.version}`;

  return {
    files,
    async diffFile({ path, changeType }, options) {
      const oldFile = oldFiles.get(path);
      const newFile = newFiles.get(path);
      let oldContent = oldFile?.content ?? '';
      let newContent = newFile?.content ?? '';

      let formatError: string | undefined;
      const languageParser = options.normalizeSyntax ? getPrettierParser(path) : null;
      if (languageParser) {
        const parser = `${languageParser}${NORMALIZED_SUFFIX}`;
        try {
          [oldContent, newContent] = await Promise.all([
            formatFile(oldFile, parser),
            formatFile(newFile, parser),
          ]);
        } catch (error) {
          // Both sides keep their raw contents, a half formatted diff is useless
          formatError = error instanceof Error ? error.message : String(error);
        }
        if (oldContent === newContent) {
          return null;
        }
      }

      return {
        path,
        changeType,
        blocks: createDiffBlocks(
          path,
          oldContent,
          newContent,
          oldHeader,
          newHeader,
          options.ignoreWhitespace,
        ),
        formatError,
      };
    },
  };
}
