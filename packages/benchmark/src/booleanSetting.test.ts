import { afterEach, describe, expect, it } from 'vitest';
import { resolveBooleanSetting } from './booleanSetting';

const NAME = 'BENCHMARK_TEST_SETTING';

describe('resolveBooleanSetting', () => {
  afterEach(() => {
    delete process.env[NAME];
  });

  it('falls back when the variable is unset or empty', () => {
    expect(resolveBooleanSetting(NAME, undefined, true, '')).toBe(true);
    process.env[NAME] = '';
    expect(resolveBooleanSetting(NAME, undefined, false, '')).toBe(false);
  });

  it.each([
    ['true', true],
    ['1', true],
    ['false', false],
    ['0', false],
  ])('reads %s', (value, expected) => {
    process.env[NAME] = value;
    expect(resolveBooleanSetting(NAME, undefined, !expected, '')).toBe(expected);
  });

  it('prefers the option over the variable', () => {
    process.env[NAME] = 'false';
    expect(resolveBooleanSetting(NAME, true, false, '')).toBe(true);
  });

  it.each(['yes', 'constructor', 'toString'])('rejects "%s", saying what it would do', (value) => {
    process.env[NAME] = value;
    expect(() => resolveBooleanSetting(NAME, undefined, true, 'Something would go wrong.')).toThrow(
      `Unknown ${NAME} value "${value}". Something would go wrong.`,
    );
  });
});
