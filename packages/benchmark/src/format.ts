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

export function padStart(s: string, width: number): string {
  return s.length >= width ? s : ' '.repeat(width - s.length) + s;
}

interface Column {
  header: string;
  width: number;
}

export function printTable(title: string, columns: Column[], rows: string[][]): void {
  const separator = ' | ';
  const headerCells = columns.map((col) => padStart(col.header, col.width));
  const header = headerCells.join(dim(separator));
  const line = dim('-'.repeat(headerCells.join(separator).length));

  // eslint-disable-next-line no-console
  console.log(`\n${dim(`=== ${title} ===`)}`);
  // eslint-disable-next-line no-console
  console.log(header);
  // eslint-disable-next-line no-console
  console.log(line);
  for (const row of rows) {
    // eslint-disable-next-line no-console
    console.log(row.join(dim(separator)));
  }
}
