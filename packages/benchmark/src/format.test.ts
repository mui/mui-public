import { describe, it, expect, vi } from 'vitest';
import { printTable } from './format';

describe('printTable', () => {
  it('prints title, header, separator, and rows', () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    printTable(
      'Test Table',
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

    // title + header + separator + 2 rows = 5 calls
    expect(calls).toHaveLength(5);
    // Title line contains the title text
    expect(calls[0]).toContain('Test Table');
    // Header line contains column headers
    expect(calls[1]).toContain('Name');
    expect(calls[1]).toContain('Value');
    // Data rows are present
    expect(calls[3]).toContain('foo');
    expect(calls[4]).toContain('bar');

    consoleSpy.mockRestore();
  });

  it('prints title and header with no rows', () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    printTable('Empty', [{ header: 'Col', width: 4 }], []);

    const calls = consoleSpy.mock.calls.map((call) => call[0] as string);

    // title + header + separator = 3 calls
    expect(calls).toHaveLength(3);
    expect(calls[0]).toContain('Empty');

    consoleSpy.mockRestore();
  });
});
