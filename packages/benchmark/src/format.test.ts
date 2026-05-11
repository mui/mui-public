import { describe, it, expect, vi } from 'vitest';
import { printTable } from './format';

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
