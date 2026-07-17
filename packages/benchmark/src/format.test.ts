import { describe, it, expect, vi } from 'vitest';
import { cyan, printTable } from './format';

// eslint-disable-next-line no-control-regex
const stripAnsi = (str: string) => str.replace(/\x1b\[[0-9;]*m/g, '');

describe('printTable', () => {
  it('prints a table with box-drawing characters', () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    printTable(
      [
        { header: 'Name', minWidth: 6 },
        { header: 'Value', minWidth: 5 },
      ],
      [
        ['foo', '10'],
        ['bar', '20'],
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

    printTable([{ header: 'Col', minWidth: 6 }], [['foo']], 'summary line');

    const calls = consoleSpy.mock.calls.map((call) => call[0] as string);

    // top + header + sep + 1 row + footer sep + footer + bottom = 7 calls
    expect(calls).toHaveLength(7);
    expect(calls[5]).toContain('summary line');

    consoleSpy.mockRestore();
  });

  it('prints header with no rows', () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    printTable([{ header: 'Col', minWidth: 4 }], []);

    const calls = consoleSpy.mock.calls.map((call) => call[0] as string);

    // top + header + sep + bottom = 4 calls
    expect(calls).toHaveLength(4);

    consoleSpy.mockRestore();
  });

  it('prints a title header when title is provided', () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    printTable(
      [
        { header: 'Name', minWidth: 6 },
        { header: 'Value', minWidth: 5 },
      ],
      [['foo', '10']],
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
        { header: 'Name', minWidth: 6 },
        { header: 'Value', minWidth: 5 },
      ],
      [['foo', '10']],
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
        { header: 'Name', minWidth: 6 },
        { header: 'Value', minWidth: 5 },
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

    printTable([{ header: 'Col', minWidth: 10 }], [['foo']]);

    const calls = consoleSpy.mock.calls.map((call) => call[0] as string);

    expect(stripAnsi(calls[3])).toBe('│        foo │');

    consoleSpy.mockRestore();
  });

  it('pads coloured cells by their visible width, ignoring escape codes', () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    printTable([{ header: 'Col', minWidth: 6 }], [[cyan('foo')]]);

    const calls = consoleSpy.mock.calls.map((call) => call[0] as string);

    expect(stripAnsi(calls[3])).toBe('│    foo │');

    consoleSpy.mockRestore();
  });

  it('truncates a cell that exceeds the column maxWidth', () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    printTable([{ header: 'Col', minWidth: 6, maxWidth: 6 }], [['a-very-long-label']]);

    const calls = consoleSpy.mock.calls.map((call) => call[0] as string);

    expect(stripAnsi(calls[3])).toBe('│ a-ver… │');

    consoleSpy.mockRestore();
  });

  it('keeps colour codes when truncating, so styling does not leak', () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    printTable([{ header: 'Col', minWidth: 4, maxWidth: 4 }], [[cyan('longvalue')]]);

    const calls = consoleSpy.mock.calls.map((call) => call[0] as string);

    // Visible text is cut to the cap, and the cell still closes the colour it opened.
    expect(stripAnsi(calls[3])).toBe('│ lon… │');
    expect(calls[3]).toContain(cyan('lon'));

    consoleSpy.mockRestore();
  });

  it('grows a column to fit a header wider than its minWidth', () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    printTable([{ header: 'LongHeader', minWidth: 2 }], [['x']]);

    const calls = consoleSpy.mock.calls.map((call) => call[0] as string);

    expect(stripAnsi(calls[1])).toBe('│ LongHeader │');
    expect(stripAnsi(calls[3])).toBe('│          x │');

    consoleSpy.mockRestore();
  });

  it('widens the table for a footer too long for its columns, keeping the text', () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const footer = 'F'.repeat(60);
    printTable([{ header: 'Col', minWidth: 4 }], [['x']], footer);

    const calls = consoleSpy.mock.calls.map((call) => call[0] as string);
    const widths = calls.map((line) => stripAnsi(line).length);

    // The footer is reported in full and every line still agrees on the table width.
    expect(stripAnsi(calls[5])).toBe(`│ ${footer} │`);
    expect(new Set(widths).size).toBe(1);

    consoleSpy.mockRestore();
  });

  it('uses ┴ in footer separator', () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    printTable(
      [
        { header: 'A', minWidth: 4 },
        { header: 'B', minWidth: 4 },
      ],
      [['x1', 'x2']],
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
