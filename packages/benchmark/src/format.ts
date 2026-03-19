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
  width: number;
}

function truncate(str: string, maxLength: number): string {
  if (str.length <= maxLength) {
    return str;
  }
  return `${str.slice(0, maxLength - 1)}…`;
}

export function printTable(
  columns: Column[],
  rows: string[][],
  footer?: string,
  title?: string,
): void {
  const colWidths = columns.map((col) => col.width);
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
  const headerCells = columns.map((col) => ` ${col.header.padStart(col.width)} `);
  const headerLine = dim('│') + headerCells.join(dim('│')) + dim('│');

  // eslint-disable-next-line no-console
  console.log(headerLine);
  // eslint-disable-next-line no-console
  console.log(headerSep);

  for (const row of rows) {
    const cells = row.map((cell, i) => ` ${cell.padStart(colWidths[i])} `);
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
