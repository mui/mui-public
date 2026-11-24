import * as diff from 'diff';
import type { Parser, Plugin } from 'prettier';
import type { FileContent, PackageContents } from '../packageDownload';

export type ChangeType = 'added' | 'removed' | 'modified';

export interface DiffOptions {
  ignoreWhitespace: boolean;
  /** Run both sides through Prettier so differences in build tool output style disappear. */
  format: boolean;
  /** Leave comments out of the formatted code. Only applies when `format` is set. */
  removeComments: boolean;
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
  /** Set when formatting was requested but failed; the diff then shows the raw contents. */
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

const NO_COMMENTS_SUFFIX = '-no-comments';

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

/**
 * Adds a `<name>-no-comments` variant of every parser in `plugins`, whose AST has its
 * comments removed, so Prettier prints the code without them.
 */
function createNoCommentsPlugin(plugins: Plugin[]): Plugin {
  const parsers: Record<string, Parser> = {};
  for (const plugin of plugins) {
    for (const [name, parser] of Object.entries(plugin.parsers ?? {})) {
      parsers[`${name}${NO_COMMENTS_SUFFIX}`] = {
        ...parser,
        parse: async (text, options) => {
          const ast = await parser.parse(text, options);
          removeComments(ast);
          return ast;
        },
      };
    }
  }
  return { parsers };
}

let prettierPromise: Promise<(source: string, parser: string) => Promise<string>> | null = null;

// Prettier and its parsers are several hundred KB, only load them once formatting is requested.
function loadPrettier() {
  prettierPromise ??= Promise.all([
    import('prettier/standalone'),
    import('prettier/plugins/babel'),
    import('prettier/plugins/estree'),
    import('prettier/plugins/typescript'),
    import('prettier/plugins/postcss'),
  ]).then(([prettier, ...languagePlugins]) => {
    const plugins = [...languagePlugins, createNoCommentsPlugin(languagePlugins)];
    return (source, parser) =>
      // By default Prettier keeps an object expanded when the source had a newline after
      // `{`, which would preserve exactly the style differences this is meant to remove.
      prettier.format(source, { parser, plugins, objectWrap: 'collapse' });
  });
  return prettierPromise;
}

// Keyed by file identity and parser, so diffing the same downloaded package again with
// other options doesn't format its files a second time.
const formattedCache = new WeakMap<FileContent, Map<string, Promise<string>>>();

function formatFile(file: FileContent | undefined, parser: string): Promise<string> {
  if (!file) {
    return Promise.resolve('');
  }
  let fileCache = formattedCache.get(file);
  if (!fileCache) {
    fileCache = new Map();
    formattedCache.set(file, fileCache);
  }
  let formatted = fileCache.get(parser);
  if (!formatted) {
    formatted = loadPrettier().then((format) => format(file.content, parser));
    fileCache.set(parser, formatted);
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

async function diffFile(
  { path, changeType }: ChangedFile,
  oldFile: FileContent | undefined,
  newFile: FileContent | undefined,
  oldHeader: string,
  newHeader: string,
  options: DiffOptions,
): Promise<FileDiffResult | null> {
  let oldContent = oldFile?.content ?? '';
  let newContent = newFile?.content ?? '';

  let formatError: string | undefined;
  const languageParser = options.format ? getPrettierParser(path) : null;
  if (languageParser) {
    const parser = options.removeComments
      ? `${languageParser}${NO_COMMENTS_SUFFIX}`
      : languageParser;
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
    diffFile: (file, options) =>
      diffFile(
        file,
        oldFiles.get(file.path),
        newFiles.get(file.path),
        oldHeader,
        newHeader,
        options,
      ),
  };
}
