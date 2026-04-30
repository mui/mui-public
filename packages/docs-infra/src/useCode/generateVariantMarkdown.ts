/**
 * Pure helpers for serializing a code variant's files into a Markdown
 * snippet suitable for pasting into chat or docs.
 */

export interface MarkdownFile {
  name: string;
  source: string;
}

export interface GenerateVariantMarkdownOptions {
  /** Optional heading rendered as a level-3 Markdown heading. */
  title?: string;
  /** Files to render in order. */
  files: MarkdownFile[];
}

/**
 * Returns the file extension (without the leading dot) used as the
 * Markdown code-fence language hint. Returns an empty string when the
 * filename has no usable extension.
 */
function getLanguageHint(fileName: string): string {
  const lastDot = fileName.lastIndexOf('.');
  if (lastDot <= 0 || lastDot === fileName.length - 1) {
    return '';
  }
  return fileName.slice(lastDot + 1);
}

/**
 * Returns a fence string at least one backtick longer than the longest
 * run of backticks in any of the file sources. This guarantees the fence
 * cannot be terminated by content inside the code block.
 */
function pickFence(files: MarkdownFile[]): string {
  let longestRun = 2;
  for (const file of files) {
    const matches = file.source.match(/`+/g);
    if (!matches) {
      continue;
    }
    for (const match of matches) {
      if (match.length > longestRun) {
        longestRun = match.length;
      }
    }
  }
  return '`'.repeat(longestRun + 1);
}

export function generateVariantMarkdown({ title, files }: GenerateVariantMarkdownOptions): string {
  if (files.length === 0) {
    return '';
  }

  const fence = pickFence(files);
  const sections: string[] = [];

  if (title) {
    sections.push(`### ${title}`);
  }

  for (const file of files) {
    const language = getLanguageHint(file.name);
    const body = file.source.replace(/\n+$/, '');
    sections.push(`**${file.name}**\n\n${fence}${language}\n${body}\n${fence}`);
  }

  return `${sections.join('\n\n')}\n`;
}
