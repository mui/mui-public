import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { describe, it, expect } from 'vitest';
import { makeTempDir } from '../utils/testUtils.mjs';
import { getReplacementText, applyFixes } from './cmdVale.mjs';

describe('getReplacementText', () => {
  describe('with explicit Action.Name="replace"', () => {
    it('returns the first param when Action has replace params', () => {
      const alert = {
        Action: { Name: 'replace', Params: ['for example'] },
        Message: "Use 'for example' instead of 'eg'",
      };
      expect(getReplacementText(alert)).toBe('for example');
    });

    it('returns the first param even with multiple params', () => {
      const alert = {
        Action: { Name: 'replace', Params: ['first', 'second'] },
        Message: "Use 'first' instead of 'bad'",
      };
      expect(getReplacementText(alert)).toBe('first');
    });

    it('falls back to message parsing when Action.Name is replace but Params is null', () => {
      const alert = {
        Action: { Name: 'replace', Params: null },
        Message: "Use 'color' instead of 'colour'",
      };
      expect(getReplacementText(alert)).toBe('color');
    });

    it('falls back to message parsing when Action.Name is replace but Params is empty', () => {
      const alert = {
        Action: { Name: 'replace', Params: [] },
        Message: "Use 'color' instead of 'colour'",
      };
      expect(getReplacementText(alert)).toBe('color');
    });
  });

  describe('with no explicit Action (message parsing)', () => {
    it('parses simple "Use X instead of Y" messages', () => {
      const alert = {
        Action: { Name: '', Params: null },
        Message: "Use 'npm' instead of 'NPM'",
      };
      expect(getReplacementText(alert)).toBe('npm');
    });

    it('parses messages with extra words before first quote', () => {
      const alert = {
        Action: { Name: '', Params: null },
        Message: "Use the US spelling 'color' instead of the British 'colour'",
      };
      expect(getReplacementText(alert)).toBe('color');
    });

    it('parses messages with extra words between instead-of and second quote', () => {
      const alert = {
        Action: { Name: '', Params: null },
        Message: "Use the US spelling 'gray' instead of the British 'grey'",
      };
      expect(getReplacementText(alert)).toBe('gray');
    });

    it('parses non-breaking space messages', () => {
      const alert = {
        Action: { Name: '', Params: null },
        Message:
          "Use a non-breaking space (option+space on Mac, Alt+0160 on Windows or AltGr+Space on Linux, instead of space) for brand name ('Material\u00a0UI' instead of 'Material UI')",
      };
      expect(getReplacementText(alert)).toBe('Material\u00a0UI');
    });

    it('parses "Use X instead of Y" with e.g. and periods', () => {
      const alert = {
        Action: { Name: '', Params: null },
        Message: "Use 'e.g.' instead of 'eg'",
      };
      expect(getReplacementText(alert)).toBe('e.g.');
    });

    it('parses TypeScript-style replacements', () => {
      const alert = {
        Action: { Name: '', Params: null },
        Message: "Use 'TypeScript ' instead of 'typescript '",
      };
      expect(getReplacementText(alert)).toBe('TypeScript ');
    });

    it('returns null for messages without the expected pattern', () => {
      const alert = {
        Action: { Name: '', Params: null },
        Message:
          "We avoid referencing the company name 'MUI Dashboard'. Instead you can reference a product or the team.",
      };
      expect(getReplacementText(alert)).toBeNull();
    });

    it('returns null for completely unstructured messages', () => {
      const alert = {
        Action: { Name: '', Params: null },
        Message: 'This sentence is too long.',
      };
      expect(getReplacementText(alert)).toBeNull();
    });
  });
});

describe('applyFixes', () => {
  /**
   * Helper to create a temp file and return its path.
   * @param {string} name
   * @param {string} content
   * @returns {Promise<string>}
   */
  async function createFile(name, content) {
    const tmpDir = await makeTempDir();
    const filePath = path.join(tmpDir, name);
    await fs.writeFile(filePath, content, 'utf-8');
    return filePath;
  }

  /**
   * @param {string} filePath
   * @returns {Promise<string>}
   */
  async function readFile(filePath) {
    return fs.readFile(filePath, 'utf-8');
  }

  it('applies a single fix on a single line', async () => {
    const filePath = await createFile('test.md', 'The colour is nice.\n');
    const results = {
      [filePath]: [
        {
          Action: { Name: '', Params: null },
          Span: /** @type {[number, number]} */ ([5, 10]),
          Check: 'MUI.NoBritish',
          Message: "Use the US spelling 'color' instead of the British 'colour'",
          Severity: 'error',
          Match: 'colour',
          Line: 1,
        },
      ],
    };

    const { fixed, skipped } = await applyFixes(results, 'all');
    expect(fixed).toBe(1);
    expect(skipped).toBe(0);
    expect(await readFile(filePath)).toBe('The color is nice.\n');
  });

  it('applies multiple fixes on the same line (right-to-left)', async () => {
    const filePath = await createFile('test.md', 'The colour is grey today.\n');
    const results = {
      [filePath]: [
        {
          Action: { Name: '', Params: null },
          Span: /** @type {[number, number]} */ ([5, 10]),
          Check: 'MUI.NoBritish',
          Message: "Use the US spelling 'color' instead of the British 'colour'",
          Severity: 'error',
          Match: 'colour',
          Line: 1,
        },
        {
          Action: { Name: '', Params: null },
          Span: /** @type {[number, number]} */ ([15, 18]),
          Check: 'MUI.NoBritish',
          Message: "Use the US spelling 'gray' instead of the British 'grey'",
          Severity: 'error',
          Match: 'grey',
          Line: 1,
        },
      ],
    };

    const { fixed, skipped } = await applyFixes(results, 'all');
    expect(fixed).toBe(2);
    expect(skipped).toBe(0);
    expect(await readFile(filePath)).toBe('The color is gray today.\n');
  });

  it('applies fixes across multiple lines', async () => {
    const filePath = await createFile('test.md', 'The colour is nice.\nThe grey sky.\n');
    const results = {
      [filePath]: [
        {
          Action: { Name: '', Params: null },
          Span: /** @type {[number, number]} */ ([5, 10]),
          Check: 'MUI.NoBritish',
          Message: "Use the US spelling 'color' instead of the British 'colour'",
          Severity: 'error',
          Match: 'colour',
          Line: 1,
        },
        {
          Action: { Name: '', Params: null },
          Span: /** @type {[number, number]} */ ([5, 8]),
          Check: 'MUI.NoBritish',
          Message: "Use the US spelling 'gray' instead of the British 'grey'",
          Severity: 'error',
          Match: 'grey',
          Line: 2,
        },
      ],
    };

    const { fixed, skipped } = await applyFixes(results, 'all');
    expect(fixed).toBe(2);
    expect(skipped).toBe(0);
    expect(await readFile(filePath)).toBe('The color is nice.\nThe gray sky.\n');
  });

  it('applies fixes with explicit Action replace params', async () => {
    const filePath = await createFile('test.md', 'Use eg in a sentence.\n');
    const results = {
      [filePath]: [
        {
          Action: { Name: 'replace', Params: ['for example'] },
          Span: /** @type {[number, number]} */ ([5, 6]),
          Check: 'MUI.GoogleLatin',
          Message: "Use 'for example' instead of 'eg'",
          Severity: 'error',
          Match: 'eg',
          Line: 1,
        },
      ],
    };

    const { fixed, skipped } = await applyFixes(results, 'all');
    expect(fixed).toBe(1);
    expect(skipped).toBe(0);
    expect(await readFile(filePath)).toBe('Use for example in a sentence.\n');
  });

  it('deduplicates alerts at the same location', async () => {
    const filePath = await createFile('test.md', 'Use eg here.\n');
    const results = {
      [filePath]: [
        {
          Action: { Name: 'replace', Params: ['for example'] },
          Span: /** @type {[number, number]} */ ([5, 6]),
          Check: 'MUI.GoogleLatin',
          Message: "Use 'for example' instead of 'eg'",
          Severity: 'error',
          Match: 'eg',
          Line: 1,
        },
        {
          Action: { Name: '', Params: null },
          Span: /** @type {[number, number]} */ ([5, 6]),
          Check: 'MUI.CorrectRererenceCased',
          Message: "Use 'e.g.' instead of 'eg'",
          Severity: 'error',
          Match: 'eg',
          Line: 1,
        },
      ],
    };

    const { fixed } = await applyFixes(results, 'all');
    // Only one fix applied despite two alerts at the same position
    expect(fixed).toBe(1);
    expect(await readFile(filePath)).toBe('Use for example here.\n');
  });

  describe('fixLevel filtering', () => {
    it('fixes only errors when fixLevel is "error"', async () => {
      const filePath = await createFile('test.md', 'The MUI Dashboard has colour.\n');
      const results = {
        [filePath]: [
          {
            Action: { Name: '', Params: null },
            Span: /** @type {[number, number]} */ ([5, 17]),
            Check: 'MUI.NoCompanyName',
            Message:
              "We avoid referencing the company name 'MUI Dashboard'. Instead you can reference a product or the team.",
            Severity: 'warning',
            Match: 'MUI Dashboard',
            Line: 1,
          },
          {
            Action: { Name: '', Params: null },
            Span: /** @type {[number, number]} */ ([23, 28]),
            Check: 'MUI.NoBritish',
            Message: "Use the US spelling 'color' instead of the British 'colour'",
            Severity: 'error',
            Match: 'colour',
            Line: 1,
          },
        ],
      };

      const { fixed, skipped } = await applyFixes(results, 'error');
      expect(fixed).toBe(1);
      expect(skipped).toBe(1);
      expect(await readFile(filePath)).toBe('The MUI Dashboard has color.\n');
    });

    it('fixes both errors and warnings when fixLevel is "all"', async () => {
      const filePath = await createFile('test.md', 'NPM is colour.\n');
      const results = {
        [filePath]: [
          {
            Action: { Name: '', Params: null },
            Span: /** @type {[number, number]} */ ([1, 3]),
            Check: 'MUI.CorrectReferenceAllCases',
            Message: "Use 'npm' instead of 'NPM'",
            Severity: 'warning',
            Match: 'NPM',
            Line: 1,
          },
          {
            Action: { Name: '', Params: null },
            Span: /** @type {[number, number]} */ ([8, 13]),
            Check: 'MUI.NoBritish',
            Message: "Use the US spelling 'color' instead of the British 'colour'",
            Severity: 'error',
            Match: 'colour',
            Line: 1,
          },
        ],
      };

      const { fixed, skipped } = await applyFixes(results, 'all');
      expect(fixed).toBe(2);
      expect(skipped).toBe(0);
      expect(await readFile(filePath)).toBe('npm is color.\n');
    });
  });

  it('skips alerts with no determinable replacement', async () => {
    const filePath = await createFile('test.md', 'The MUI Dashboard is great.\n');
    const results = {
      [filePath]: [
        {
          Action: { Name: '', Params: null },
          Span: /** @type {[number, number]} */ ([5, 17]),
          Check: 'MUI.NoCompanyName',
          Message:
            "We avoid referencing the company name 'MUI Dashboard'. Instead you can reference a product or the team.",
          Severity: 'warning',
          Match: 'MUI Dashboard',
          Line: 1,
        },
      ],
    };

    const { fixed, skipped } = await applyFixes(results, 'all');
    expect(fixed).toBe(0);
    expect(skipped).toBe(1);
    // File should be unchanged
    expect(await readFile(filePath)).toBe('The MUI Dashboard is great.\n');
  });

  it('handles multiple files', async () => {
    const file1 = await createFile('a.md', 'The colour.\n');
    const file2 = await createFile('b.md', 'The grey sky.\n');
    const results = {
      [file1]: [
        {
          Action: { Name: '', Params: null },
          Span: /** @type {[number, number]} */ ([5, 10]),
          Check: 'MUI.NoBritish',
          Message: "Use the US spelling 'color' instead of the British 'colour'",
          Severity: 'error',
          Match: 'colour',
          Line: 1,
        },
      ],
      [file2]: [
        {
          Action: { Name: '', Params: null },
          Span: /** @type {[number, number]} */ ([5, 8]),
          Check: 'MUI.NoBritish',
          Message: "Use the US spelling 'gray' instead of the British 'grey'",
          Severity: 'error',
          Match: 'grey',
          Line: 1,
        },
      ],
    };

    const { fixed, skipped } = await applyFixes(results, 'all');
    expect(fixed).toBe(2);
    expect(skipped).toBe(0);
    expect(await readFile(file1)).toBe('The color.\n');
    expect(await readFile(file2)).toBe('The gray sky.\n');
  });

  it('applies multiple fixes on the same line and across different lines', async () => {
    const filePath = await createFile(
      'test.md',
      'The colour is grey.\nI like NPM and eg stuff.\nThis line is fine.\nMore colour here.\n',
    );
    const results = {
      [filePath]: [
        {
          Action: { Name: '', Params: null },
          Span: /** @type {[number, number]} */ ([5, 10]),
          Check: 'MUI.NoBritish',
          Message: "Use the US spelling 'color' instead of the British 'colour'",
          Severity: 'error',
          Match: 'colour',
          Line: 1,
        },
        {
          Action: { Name: '', Params: null },
          Span: /** @type {[number, number]} */ ([15, 18]),
          Check: 'MUI.NoBritish',
          Message: "Use the US spelling 'gray' instead of the British 'grey'",
          Severity: 'error',
          Match: 'grey',
          Line: 1,
        },
        {
          Action: { Name: '', Params: null },
          Span: /** @type {[number, number]} */ ([8, 10]),
          Check: 'MUI.CorrectReferenceAllCases',
          Message: "Use 'npm' instead of 'NPM'",
          Severity: 'error',
          Match: 'NPM',
          Line: 2,
        },
        {
          Action: { Name: 'replace', Params: ['for example'] },
          Span: /** @type {[number, number]} */ ([16, 17]),
          Check: 'MUI.GoogleLatin',
          Message: "Use 'for example' instead of 'eg'",
          Severity: 'error',
          Match: 'eg',
          Line: 2,
        },
        {
          Action: { Name: '', Params: null },
          Span: /** @type {[number, number]} */ ([6, 11]),
          Check: 'MUI.NoBritish',
          Message: "Use the US spelling 'color' instead of the British 'colour'",
          Severity: 'error',
          Match: 'colour',
          Line: 4,
        },
      ],
    };

    const { fixed, skipped } = await applyFixes(results, 'all');
    expect(fixed).toBe(5);
    expect(skipped).toBe(0);
    expect(await readFile(filePath)).toBe(
      'The color is gray.\nI like npm and for example stuff.\nThis line is fine.\nMore color here.\n',
    );
  });

  it('handles empty results', async () => {
    const { fixed, skipped } = await applyFixes({}, 'all');
    expect(fixed).toBe(0);
    expect(skipped).toBe(0);
  });

  it('handles a file with no fixable alerts (all unfixable)', async () => {
    const filePath = await createFile('test.md', 'Something wrong.\n');
    const results = {
      [filePath]: [
        {
          Action: { Name: '', Params: null },
          Span: /** @type {[number, number]} */ ([1, 9]),
          Check: 'SomeRule',
          Message: 'This sentence is problematic.',
          Severity: 'error',
          Match: 'Something',
          Line: 1,
        },
      ],
    };

    const { fixed, skipped } = await applyFixes(results, 'all');
    expect(fixed).toBe(0);
    expect(skipped).toBe(1);
    expect(await readFile(filePath)).toBe('Something wrong.\n');
  });

  it('handles replacement that changes string length (shorter to longer)', async () => {
    const filePath = await createFile('test.md', 'Use eg here and eg there.\n');
    const results = {
      [filePath]: [
        {
          Action: { Name: 'replace', Params: ['for example'] },
          Span: /** @type {[number, number]} */ ([5, 6]),
          Check: 'MUI.GoogleLatin',
          Message: "Use 'for example' instead of 'eg'",
          Severity: 'error',
          Match: 'eg',
          Line: 1,
        },
        {
          Action: { Name: 'replace', Params: ['for example'] },
          Span: /** @type {[number, number]} */ ([17, 18]),
          Check: 'MUI.GoogleLatin',
          Message: "Use 'for example' instead of 'eg'",
          Severity: 'error',
          Match: 'eg',
          Line: 1,
        },
      ],
    };

    const { fixed } = await applyFixes(results, 'all');
    expect(fixed).toBe(2);
    expect(await readFile(filePath)).toBe('Use for example here and for example there.\n');
  });

  it('handles replacement that changes string length (longer to shorter)', async () => {
    const filePath = await createFile('test.md', 'The favourite colour is great.\n');
    const results = {
      [filePath]: [
        {
          Action: { Name: '', Params: null },
          Span: /** @type {[number, number]} */ ([5, 13]),
          Check: 'MUI.NoBritish',
          Message: "Use the US spelling 'favorite' instead of the British 'favourite'",
          Severity: 'error',
          Match: 'favourite',
          Line: 1,
        },
        {
          Action: { Name: '', Params: null },
          Span: /** @type {[number, number]} */ ([15, 20]),
          Check: 'MUI.NoBritish',
          Message: "Use the US spelling 'color' instead of the British 'colour'",
          Severity: 'error',
          Match: 'colour',
          Line: 1,
        },
      ],
    };

    const { fixed } = await applyFixes(results, 'all');
    expect(fixed).toBe(2);
    expect(await readFile(filePath)).toBe('The favorite color is great.\n');
  });

  it('preserves lines that have no alerts', async () => {
    const filePath = await createFile(
      'test.md',
      'Line one is fine.\nLine two has colour.\nLine three is fine.\n',
    );
    const results = {
      [filePath]: [
        {
          Action: { Name: '', Params: null },
          Span: /** @type {[number, number]} */ ([14, 19]),
          Check: 'MUI.NoBritish',
          Message: "Use the US spelling 'color' instead of the British 'colour'",
          Severity: 'error',
          Match: 'colour',
          Line: 2,
        },
      ],
    };

    const { fixed } = await applyFixes(results, 'all');
    expect(fixed).toBe(1);
    expect(await readFile(filePath)).toBe(
      'Line one is fine.\nLine two has color.\nLine three is fine.\n',
    );
  });

  it('handles fix at the start of a line', async () => {
    const filePath = await createFile('test.md', 'NPM is great.\n');
    const results = {
      [filePath]: [
        {
          Action: { Name: '', Params: null },
          Span: /** @type {[number, number]} */ ([1, 3]),
          Check: 'MUI.CorrectReferenceAllCases',
          Message: "Use 'npm' instead of 'NPM'",
          Severity: 'error',
          Match: 'NPM',
          Line: 1,
        },
      ],
    };

    const { fixed } = await applyFixes(results, 'all');
    expect(fixed).toBe(1);
    expect(await readFile(filePath)).toBe('npm is great.\n');
  });

  it('handles fix at the end of a line', async () => {
    const filePath = await createFile('test.md', 'I like colour\n');
    const results = {
      [filePath]: [
        {
          Action: { Name: '', Params: null },
          Span: /** @type {[number, number]} */ ([8, 13]),
          Check: 'MUI.NoBritish',
          Message: "Use the US spelling 'color' instead of the British 'colour'",
          Severity: 'error',
          Match: 'colour',
          Line: 1,
        },
      ],
    };

    const { fixed } = await applyFixes(results, 'all');
    expect(fixed).toBe(1);
    expect(await readFile(filePath)).toBe('I like color\n');
  });

  it('handles mixed fixable and unfixable alerts in the same file', async () => {
    const filePath = await createFile('test.md', 'MUI Dashboard colour.\n');
    const results = {
      [filePath]: [
        {
          Action: { Name: '', Params: null },
          Span: /** @type {[number, number]} */ ([1, 13]),
          Check: 'MUI.NoCompanyName',
          Message:
            "We avoid referencing the company name 'MUI Dashboard'. Instead you can reference a product or the team.",
          Severity: 'warning',
          Match: 'MUI Dashboard',
          Line: 1,
        },
        {
          Action: { Name: '', Params: null },
          Span: /** @type {[number, number]} */ ([15, 20]),
          Check: 'MUI.NoBritish',
          Message: "Use the US spelling 'color' instead of the British 'colour'",
          Severity: 'error',
          Match: 'colour',
          Line: 1,
        },
      ],
    };

    const { fixed, skipped } = await applyFixes(results, 'all');
    expect(fixed).toBe(1);
    expect(skipped).toBe(1);
    expect(await readFile(filePath)).toBe('MUI Dashboard color.\n');
  });
});
