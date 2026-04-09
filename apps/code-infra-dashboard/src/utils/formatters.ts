const durationFormatter = new Intl.NumberFormat(undefined, {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export const percentFormatter = new Intl.NumberFormat(undefined, {
  style: 'percent',
  signDisplay: 'exceptZero',
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

export function formatMs(value: number): string {
  return `${durationFormatter.format(value)} ms`;
}

export function formatDiffMs(value: number): string {
  const sign = value > 0 ? '+' : '';
  return `${sign}${durationFormatter.format(value)} ms`;
}

interface ColumnDefinition {
  field: string;
  header?: string;
  align?: 'left' | 'center' | 'right';
}

export function formatMarkdownTable(
  columns: ColumnDefinition[],
  data: Partial<Record<string, unknown>>[],
): string {
  let table = '';

  const headers = columns.map((col) => col.header || col.field);
  const alignments = columns.map((col) => col.align || 'left');

  table += `| ${headers.join(' | ')} |\n`;

  const separators = alignments.map((align) => {
    switch (align) {
      case 'center':
        return ':---------:';
      case 'right':
        return '----------:';
      case 'left':
        return ':----------';
      default:
        return '-----------';
    }
  });
  table += `|${separators.join('|')}|\n`;

  data.forEach((row) => {
    const cells = columns.map((col) => row[col.field] ?? '');
    table += `| ${cells.join(' | ')} |\n`;
  });

  return table;
}
