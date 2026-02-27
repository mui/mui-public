import * as React from 'react';

export const PLACEHOLDER = 'e.g., *.ts, !*.test.ts, !*.d.ts';

function patternToRegex(pattern: string): RegExp {
  if (pattern.includes('*')) {
    // Glob pattern: escape regex chars, convert * to .*, anchor
    const regexPattern = pattern.replace(/[.+?^${}()|[\]\\*]/g, (char) =>
      char === '*' ? '.*' : `\\${char}`,
    );
    return new RegExp(`^${regexPattern}$`, 'i');
  }
  // Plain string: substring match via unanchored regex
  const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(escaped, 'i');
}

interface CompiledRule {
  negated: boolean;
  regex: RegExp;
}

/**
 * Compiles a filter expression into a filter function.
 *
 * Patterns are comma-separated. Prefix with `!` to negate.
 * Patterns are applied sequentially — last matching pattern wins.
 * Initial value is derived from the first pattern:
 * - positive first → start excluded (false)
 * - negative first → start included (true)
 * Empty expression matches everything.
 */
export function compileFilter(expression: string): (path: string) => boolean {
  const rules: CompiledRule[] = [];

  for (const token of expression.split(',')) {
    const trimmed = token.trim();
    if (!trimmed) {
      continue;
    }

    const negated = trimmed.startsWith('!');
    const raw = negated ? trimmed.slice(1).trim() : trimmed;
    if (!raw) {
      continue;
    }

    rules.push({ negated, regex: patternToRegex(raw) });
  }

  if (rules.length === 0) {
    return () => true;
  }

  const initialValue = rules[0].negated;

  return (path: string) => {
    let included = initialValue;
    for (const rule of rules) {
      if (rule.regex.test(path)) {
        included = !rule.negated;
      }
    }
    return included;
  };
}

export function useFilteredItems<T extends { path: string }>(items: T[], filter: string): T[] {
  const deferredFilter = React.useDeferredValue(filter);

  const filterFn = React.useMemo(() => compileFilter(deferredFilter), [deferredFilter]);

  return React.useMemo(() => items.filter((item) => filterFn(item.path)), [items, filterFn]);
}
