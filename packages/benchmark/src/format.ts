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

/** Matches an ANSI colour code. Captured, so `split` keeps the codes alongside the text. */
// eslint-disable-next-line no-control-regex
const ANSI_PATTERN = /(\x1b\[[0-9;]*m)/g;

function stripAnsi(str: string): string {
  return str.replace(ANSI_PATTERN, '');
}

export interface Column {
  header: string;
  /** Width the column keeps when every cell is narrower. It grows to fit a wider cell. */
  minWidth: number;
  /**
   * Width the column may not exceed; wider cells are truncated with an ellipsis. Omit to let the
   * column grow freely, which is what a value the caller can't pre-measure (a metric formatted with
   * an arbitrary unit) needs — truncating those would destroy the number the table exists to show.
   */
  maxWidth?: number;
}

/** Printable width, i.e. ignoring the zero-width ANSI escape codes that colour a string. */
function visibleWidth(str: string): number {
  return stripAnsi(str).length;
}

/**
 * Truncates to a visible width, marking the cut with an ellipsis. Escape codes are carried over
 * rather than counted, so a styled string keeps the closing code that would otherwise be dropped
 * along with the text it terminated (leaving the rest of the terminal painted).
 */
function truncate(str: string, maxWidth: number): string {
  if (visibleWidth(str) <= maxWidth) {
    return str;
  }
  let result = '';
  let remaining = maxWidth - 1;
  for (const segment of str.split(ANSI_PATTERN)) {
    if (segment.startsWith('\x1b')) {
      result += segment;
    } else if (remaining > 0) {
      result += segment.slice(0, remaining);
      remaining -= Math.min(segment.length, remaining);
    }
  }
  return `${result}…`;
}

/** Right-aligns to a visible width, so colour codes in the cell don't eat into the padding. */
function padCell(cell: string, width: number): string {
  return ' '.repeat(Math.max(0, width - visibleWidth(cell))) + cell;
}

/** Fits a string to an exact visible width, truncating or padding as needed. */
function fitCell(cell: string, width: number): string {
  return padCell(truncate(cell, width), width);
}

export function printTable(
  columns: Column[],
  rows: string[][],
  footer?: string,
  title?: string,
): void {
  // Cells are sized off content, because a caller can't know how wide a value will render (a metric
  // carrying a unit — `0.456 ms±0.057 ms` — is far wider than a bare `0.46±0.06`). Padding a cell
  // that already overflows its column is a no-op, which used to let one long value push that row's
  // dividers out of line with every other row.
  const colWidths = columns.map((col, index) => {
    const content = Math.max(
      col.minWidth,
      visibleWidth(col.header),
      ...rows.map((row) => visibleWidth(row[index] ?? '')),
    );
    return col.maxWidth === undefined ? content : Math.min(content, col.maxWidth);
  });

  const innerWidth = () => colWidths.reduce((sum, w) => sum + w + 2, 0) + colWidths.length - 1;
  // The footer spans the whole table, so it too can be the widest thing in it. It reports counts
  // that are worth nothing abbreviated, so the table stretches to fit it — the slack goes on the
  // last column, keeping the columns left of it where the reader expects. A title, by contrast, is
  // a name: arbitrarily long, and legible truncated, so it fits itself to the table below.
  const footerWidth = footer ? visibleWidth(footer) + 2 : 0;
  if (colWidths.length > 0 && footerWidth > innerWidth()) {
    colWidths[colWidths.length - 1] += footerWidth - innerWidth();
  }
  const totalInner = innerWidth();

  if (title) {
    const titleTop = dim(`┌${'─'.repeat(totalInner)}┐`);
    const titleContent = ` ${truncate(title, totalInner - 2)}`;
    const titlePadding = totalInner - visibleWidth(titleContent);
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
  const headerCells = columns.map((col, index) => ` ${fitCell(col.header, colWidths[index])} `);
  const headerLine = dim('│') + headerCells.join(dim('│')) + dim('│');

  // eslint-disable-next-line no-console
  console.log(headerLine);
  // eslint-disable-next-line no-console
  console.log(headerSep);

  for (const row of rows) {
    // Driven by the columns, not the row, so a short row still emits every cell and divider.
    const cells = colWidths.map((width, index) => ` ${fitCell(row[index] ?? '', width)} `);
    // eslint-disable-next-line no-console
    console.log(dim('│') + cells.join(dim('│')) + dim('│'));
  }

  if (footer) {
    const footerSep = dim(`├${colWidths.map((w) => '─'.repeat(w + 2)).join('┴')}┤`);
    const footerContent = ` ${footer}`;
    const padding = totalInner - visibleWidth(footerContent);
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
