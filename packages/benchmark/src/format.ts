import { pathToFileURL } from 'node:url';
import { styleText } from 'node:util';

export const dim = (s: string) => styleText('dim', s);
export const red = (s: string) => styleText('red', s);
export const green = (s: string) => styleText('green', s);
export const yellow = (s: string) => styleText('yellow', s);
export const cyan = (s: string) => styleText('cyan', s);

export function fileUrl(filePath: string): string {
  return pathToFileURL(filePath).href;
}

interface Column {
  header: string;
  /**
   * Minimum width. A column grows to fit its widest cell, so callers only need to pick the width
   * they want the column to keep when its content is narrower.
   */
  width: number;
}

function truncate(str: string, maxLength: number): string {
  if (str.length <= maxLength) {
    return str;
  }
  return `${str.slice(0, maxLength - 1)}…`;
}

/** Right-aligns to a visible width, so colour codes in the cell don't eat into the padding. */
function padCell(cell: string, width: number): string {
  return ' '.repeat(Math.max(0, width - stripAnsi(cell).length)) + cell;
}

export function printTable(
  columns: Column[],
  rows: string[][],
  footer?: string,
  title?: string,
): void {
  // Declared widths are minimums: cells are sized off content, because a caller can't know how wide
  // a value will render (a metric carrying a unit — `0.456 ms±0.057 ms` — is far wider than a bare
  // `0.46±0.06`). Padding a cell that already overflows its column is a no-op, which used to let one
  // long value push that row's dividers out of line with every other row.
  const colWidths = columns.map((col, index) =>
    Math.max(
      col.width,
      stripAnsi(col.header).length,
      ...rows.map((row) => stripAnsi(row[index] ?? '').length),
    ),
  );
  const totalInner = colWidths.reduce((sum, w) => sum + w + 2, 0) + colWidths.length - 1;

  if (title) {
    const titleTop = dim(`┌${'─'.repeat(totalInner)}┐`);
    const titleContent = ` ${truncate(title, totalInner - 2)}`;
    const titlePadding = totalInner - titleContent.length;
    const titleLine = dim('│') + titleContent + ' '.repeat(Math.max(0, titlePadding)) + dim('│');
    const titleSep = dim(`├${colWidths.map((w) => '─'.repeat(w + 2)).join('┬')}┤`);

    // eslint-disable-next-line no-console
    console.log(titleTop);
    // eslint-disable-next-line no-console
    console.log(titleLine);
    // eslint-disable-next-line no-console
    console.log(titleSep);
  } else {
    const topBorder = dim(`┌${colWidths.map((w) => '─'.repeat(w + 2)).join('┬')}┐`);
    // eslint-disable-next-line no-console
    console.log(topBorder);
  }

  const headerSep = dim(`├${colWidths.map((w) => '─'.repeat(w + 2)).join('┼')}┤`);
  const headerCells = columns.map((col, index) => ` ${padCell(col.header, colWidths[index])} `);
  const headerLine = dim('│') + headerCells.join(dim('│')) + dim('│');

  // eslint-disable-next-line no-console
  console.log(headerLine);
  // eslint-disable-next-line no-console
  console.log(headerSep);

  for (const row of rows) {
    const cells = row.map((cell, index) => ` ${padCell(cell, colWidths[index])} `);
    // eslint-disable-next-line no-console
    console.log(dim('│') + cells.join(dim('│')) + dim('│'));
  }

  if (footer) {
    const footerSep = dim(`├${colWidths.map((w) => '─'.repeat(w + 2)).join('┴')}┤`);
    const footerContent = ` ${footer}`;
    const padding = totalInner - stripAnsi(footerContent).length;
    const footerLine = dim('│') + footerContent + ' '.repeat(Math.max(0, padding)) + dim('│');
    const bottomBorder = dim(`└${'─'.repeat(totalInner)}┘`);

    // eslint-disable-next-line no-console
    console.log(footerSep);
    // eslint-disable-next-line no-console
    console.log(footerLine);
    // eslint-disable-next-line no-console
    console.log(bottomBorder);
  } else {
    const bottomBorder = dim(`└${colWidths.map((w) => '─'.repeat(w + 2)).join('┴')}┘`);
    // eslint-disable-next-line no-console
    console.log(bottomBorder);
  }
}

// Strip ANSI escape codes to measure visible string length
function stripAnsi(str: string): string {
  // eslint-disable-next-line no-control-regex
  return str.replace(/\x1b\[[0-9;]*m/g, '');
}
