import { describe, it, expect, vi } from 'vitest';
import { cyan, printTable } from './format';

// eslint-disable-next-line no-control-regex
const stripAnsi = (str: string) => str.replace(/\x1b\[[0-9;]*m/g, '');

describe('printTable', () => {
  it('prints a table with box-drawing characters', () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    printTable(
      [
        { header: 'Name', width: 6 },
        { header: 'Value', width: 5 },
      ],
      [
        ['   foo', '   10'],
        ['   bar', '   20'],
      ],
    );

    const calls = consoleSpy.mock.calls.map((call) => call[0] as string);

    // top border + header + separator + 2 rows + bottom border = 6 calls
    expect(calls).toHaveLength(6);
    // Top border uses box-drawing
    expect(calls[0]).toContain('┌');
    expect(calls[0]).toContain('┐');
    // Header contains column names
    expect(calls[1]).toContain('Name');
    expect(calls[1]).toContain('Value');
    // Data rows are present
    expect(calls[3]).toContain('foo');
    expect(calls[4]).toContain('bar');
    // Bottom border
    expect(calls[5]).toContain('└');
    expect(calls[5]).toContain('┘');

    consoleSpy.mockRestore();
  });

  it('prints a footer when provided', () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    printTable([{ header: 'Col', width: 6 }], [['   foo']], 'summary line');

    const calls = consoleSpy.mock.calls.map((call) => call[0] as string);

    // top + header + sep + 1 row + footer sep + footer + bottom = 7 calls
    expect(calls).toHaveLength(7);
    expect(calls[5]).toContain('summary line');

    consoleSpy.mockRestore();
  });

  it('prints header with no rows', () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    printTable([{ header: 'Col', width: 4 }], []);

    const calls = consoleSpy.mock.calls.map((call) => call[0] as string);

    // top + header + sep + bottom = 4 calls
    expect(calls).toHaveLength(4);

    consoleSpy.mockRestore();
  });

  it('prints a title header when title is provided', () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    printTable(
      [
        { header: 'Name', width: 6 },
        { header: 'Value', width: 5 },
      ],
      [['   foo', '   10']],
      undefined,
      'My Title',
    );

    const calls = consoleSpy.mock.calls.map((call) => call[0] as string);

    // title top + title line + title sep + header + header sep + 1 row + bottom = 7 calls
    expect(calls).toHaveLength(7);
    // Title top border is merged (no column dividers)
    expect(calls[0]).toContain('┌');
    expect(calls[0]).toContain('┐');
    expect(calls[0]).not.toContain('┬');
    // Title line contains the title text
    expect(calls[1]).toContain('My Title');
    // Title separator introduces column dividers
    expect(calls[2]).toContain('┬');
    // Header contains column names
    expect(calls[3]).toContain('Name');
    expect(calls[3]).toContain('Value');

    consoleSpy.mockRestore();
  });

  it('truncates long titles with ellipsis', () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const longTitle = 'A'.repeat(200);

    printTable(
      [
        { header: 'Name', width: 6 },
        { header: 'Value', width: 5 },
      ],
      [['   foo', '   10']],
      undefined,
      longTitle,
    );

    const calls = consoleSpy.mock.calls.map((call) => call[0] as string);

    // Title top border determines the table width
    const topBorder = calls[0];
    const tableWidth = stripAnsi(topBorder).length;

    // Title line should not exceed the table width
    const titleLine = calls[1];
    expect(stripAnsi(titleLine).length).toBe(tableWidth);

    // Title should end with ellipsis and a trailing space before the closing border
    const strippedTitle = stripAnsi(titleLine);
    expect(strippedTitle).toContain('…');
    expect(strippedTitle).toMatch(/… │$/);

    consoleSpy.mockRestore();
  });

  it('widens a column to fit a cell wider than its declared width', () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    // The second column declares width 5 but one cell needs 17 (e.g. a metric formatted with a
    // unit). Every line must still agree on the table width.
    printTable(
      [
        { header: 'Name', width: 6 },
        { header: 'Value', width: 5 },
      ],
      [
        ['foo', '0 ms±0 ms'],
        ['bar', '0.456 ms±0.057 ms'],
      ],
      'footer text',
      'My Title',
    );

    const calls = consoleSpy.mock.calls.map((call) => call[0] as string);
    const widths = calls.map((line) => stripAnsi(line).length);

    expect(new Set(widths).size).toBe(1);
    // 6 + 17 for the columns, 2 padding spaces each, 3 vertical borders.
    expect(widths[0]).toBe(6 + 17 + 4 + 3);

    consoleSpy.mockRestore();
  });

  it('keeps a declared width that is wider than every cell', () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    printTable([{ header: 'Col', width: 10 }], [['foo']]);

    const calls = consoleSpy.mock.calls.map((call) => call[0] as string);

    expect(stripAnsi(calls[3])).toBe('│        foo │');

    consoleSpy.mockRestore();
  });

  it('pads coloured cells by their visible width, ignoring escape codes', () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    printTable([{ header: 'Col', width: 6 }], [[cyan('foo')]]);

    const calls = consoleSpy.mock.calls.map((call) => call[0] as string);

    expect(stripAnsi(calls[3])).toBe('│    foo │');

    consoleSpy.mockRestore();
  });

  it('uses ┴ in footer separator', () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    printTable(
      [
        { header: 'A', width: 4 },
        { header: 'B', width: 4 },
      ],
      [['  x1', '  x2']],
      'footer text',
    );

    const calls = consoleSpy.mock.calls.map((call) => call[0] as string);

    // top + header + sep + 1 row + footer sep + footer + bottom = 7 calls
    expect(calls).toHaveLength(7);
    // Footer separator uses ┴
    expect(calls[4]).toContain('┴');

    consoleSpy.mockRestore();
  });
});
