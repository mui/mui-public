import * as diff from 'diff';
import type { FileContent, PackageContents } from '../packageDownload';

export type ChangeType = 'added' | 'removed' | 'modified';

export interface DiffOptions {
  ignoreWhitespace: boolean;
  /** Run both sides through Prettier so differences in build tool output style disappear. */
  format: boolean;
}

export interface DiffBlock {
  text: string;
  className: string | null;
}

export interface FileDiffResult {
  path: string;
  changeType: ChangeType;
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

let prettierPromise: Promise<(source: string, parser: string) => Promise<string>> | null = null;

// Prettier and its parsers are several hundred KB, only load them once formatting is requested.
function loadPrettier() {
  prettierPromise ??= Promise.all([
    import('prettier/standalone'),
    import('prettier/plugins/babel'),
    import('prettier/plugins/estree'),
    import('prettier/plugins/typescript'),
    import('prettier/plugins/postcss'),
  ]).then(([prettier, ...plugins]) => {
    return (source, parser) =>
      // By default Prettier keeps an object expanded when the source had a newline after
      // `{`, which would preserve exactly the style differences this is meant to remove.
      prettier.format(source, { parser, plugins, objectWrap: 'collapse' });
  });
  return prettierPromise;
}

// Keyed by file identity, so diffing the same downloaded package again with other
// options doesn't format its files a second time.
const formattedCache = new WeakMap<FileContent, Promise<string>>();

function formatFile(file: FileContent | undefined, parser: string): Promise<string> {
  if (!file) {
    return Promise.resolve('');
  }
  let formatted = formattedCache.get(file);
  if (!formatted) {
    formatted = loadPrettier().then((format) => format(file.content, parser));
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

async function diffFile(
  path: string,
  oldFile: FileContent | undefined,
  newFile: FileContent | undefined,
  oldHeader: string,
  newHeader: string,
  options: DiffOptions,
): Promise<FileDiffResult | null> {
  let oldContent = oldFile?.content ?? '';
  let newContent = newFile?.content ?? '';
  if (oldContent === newContent) {
    return null;
  }

  let formatError: string | undefined;
  const parser = options.format ? getPrettierParser(path) : null;
  if (parser) {
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

  let changeType: ChangeType = 'modified';
  if (!oldFile) {
    changeType = 'added';
  } else if (!newFile) {
    changeType = 'removed';
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

/**
 * Lists the files that differ between two packages, sorted by path, with their unified diff.
 */
export async function computePackageDiff(
  oldPackage: PackageContents,
  newPackage: PackageContents,
  options: DiffOptions,
): Promise<FileDiffResult[]> {
  const oldFiles = new Map(oldPackage.files.map((file) => [file.path, file]));
  const newFiles = new Map(newPackage.files.map((file) => [file.path, file]));
  const allPaths = Array.from(new Set([...oldFiles.keys(), ...newFiles.keys()])).sort();

  const oldHeader = `${oldPackage.name}@${oldPackage.version}`;
  const newHeader = `${newPackage.name}@${newPackage.version}`;

  const results = await Promise.all(
    allPaths.map((path) =>
      diffFile(path, oldFiles.get(path), newFiles.get(path), oldHeader, newHeader, options),
    ),
  );
  return results.filter((result) => result !== null);
}
