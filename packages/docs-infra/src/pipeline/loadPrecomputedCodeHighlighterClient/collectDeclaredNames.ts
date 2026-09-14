const IDENTIFIER_REGEX = /[A-Za-z_$][\w$]*/g;
const LEADING_IDENTIFIER_REGEX = /^([A-Za-z_$][\w$]*)/;

/**
 * Collects identifier names that are already declared in the given source
 * (top-level imports, `const`/`let`/`var` bindings, function and class
 * declarations).
 *
 * The result is used to seed conflict-resolution when injecting additional
 * imports so that we never shadow an existing binding.
 *
 * This is intentionally a lightweight regex-based scan rather than a full
 * parser: we only need to gather identifier names well enough to avoid
 * collisions; over-collecting (e.g. matching a name inside a comment) is
 * harmless because it just causes the new import to be aliased.
 */
export function collectDeclaredNames(source: string): Set<string> {
  const names = new Set<string>();

  // Imports: default, namespace, and named (with optional `as` aliases).
  // Locate each `import ... from '...';` statement with cheap string ops
  // and then parse the head separately. Doing the search with `indexOf`
  // and a single-character class avoids the polynomial backtracking that a
  // monolithic regex with multiple optional `\s+`-separated groups can
  // exhibit on adversarial input (e.g. many `import {{` repetitions).
  for (const head of iterateImportHeads(source)) {
    collectImportNames(head, names);
  }

  // Top-level `const`/`let`/`var` bindings (including destructuring, both
  // object and array). We capture the entire declaration body up to the
  // terminating `;` and harvest every identifier inside — over-collecting
  // (e.g. picking up a value identifier on the right-hand side) is harmless
  // because it only causes the new import to be aliased.
  // The leading anchor uses `[ \t]*` instead of `\s*` so it cannot overlap
  // with the preceding `\n`/`;`/`{`/`}` separator (which `\s` would also
  // match), eliminating polynomial backtracking on whitespace-heavy input.
  const declarationRegex = /(?:^|[\n;{}])[ \t]*(?:export[ \t]+)?(?:const|let|var)[ \t]+([^;]+);/g;
  for (const match of source.matchAll(declarationRegex)) {
    const binding = match[1];
    for (const idMatch of binding.matchAll(IDENTIFIER_REGEX)) {
      names.add(idMatch[0]);
    }
  }

  // Top-level function and class declarations. Same `[ \t]*` trick keeps
  // the leading-whitespace consumption non-overlapping with the line break.
  const functionRegex =
    /(?:^|\n)[ \t]*(?:export[ \t]+(?:default[ \t]+)?)?(?:async[ \t]+)?(?:function\*?|class)[ \t]+([A-Za-z_$][\w$]*)/g;
  for (const match of source.matchAll(functionRegex)) {
    names.add(match[1]);
  }

  return names;
}

/**
 * Yields the "head" of every plausible `import ... from '...'` statement in
 * `source` — the substring between the `import` keyword and the matching
 * `from`. This walks the source linearly, so every regex consumer
 * downstream operates on a bounded slice and cannot trigger the polynomial
 * backtracking that a single monolithic import-statement regex can.
 */
function* iterateImportHeads(source: string): Generator<string> {
  let cursor = 0;
  while (cursor < source.length) {
    const importIndex = source.indexOf('import', cursor);
    if (importIndex === -1) {
      return;
    }
    const afterImport = importIndex + 6;
    // Require word boundaries around the keyword so we don't match
    // identifiers like `myImport` or `importable`.
    const prevCode = importIndex > 0 ? source.charCodeAt(importIndex - 1) : 0;
    const nextCode = source.charCodeAt(afterImport);
    if (isWordChar(prevCode) || isWordChar(nextCode)) {
      cursor = importIndex + 1;
      continue;
    }
    // Look for the first quote or terminating `;`/`{` that would invalidate
    // a single-line `import ... from '...'` statement.
    let scan = afterImport;
    let quoteIndex = -1;
    let quoteChar = 0;
    while (scan < source.length) {
      const code = source.charCodeAt(scan);
      if (code === 34 /* '"' */ || code === 39 /* "'" */) {
        quoteIndex = scan;
        quoteChar = code;
        break;
      }
      if (code === 59 /* ';' */) {
        // Statement terminator with no quoted source — bail out.
        break;
      }
      scan += 1;
    }
    if (quoteIndex === -1) {
      cursor = afterImport;
      continue;
    }
    // Find the matching `from` token immediately before the quote.
    const fromIndex = findFromBefore(source, afterImport, quoteIndex);
    if (fromIndex === -1) {
      cursor = quoteIndex + 1;
      continue;
    }
    // Find the closing quote.
    const closeQuote = source.indexOf(String.fromCharCode(quoteChar), quoteIndex + 1);
    if (closeQuote === -1) {
      return;
    }
    yield source.slice(afterImport, fromIndex);
    cursor = closeQuote + 1;
  }
}

/**
 * Returns the index of the `from` token between `start` and `quoteIndex`,
 * or `-1` if there is none. Requires whitespace on both sides.
 */
function findFromBefore(source: string, start: number, quoteIndex: number): number {
  for (let index = start; index <= quoteIndex - 4; index += 1) {
    if (
      source.charCodeAt(index) === 102 /* 'f' */ &&
      source.charCodeAt(index + 1) === 114 /* 'r' */ &&
      source.charCodeAt(index + 2) === 111 /* 'o' */ &&
      source.charCodeAt(index + 3) === 109 /* 'm' */
    ) {
      const before = index > 0 ? source.charCodeAt(index - 1) : 0;
      const after = source.charCodeAt(index + 4);
      if (!isWordChar(before) && !isWordChar(after)) {
        return index;
      }
    }
  }
  return -1;
}

/**
 * True when `code` is an ASCII word character (`[A-Za-z0-9_$]`). Used for
 * cheap word-boundary checks during the manual import scan.
 */
function isWordChar(code: number): boolean {
  return (
    (code >= 48 && code <= 57) || // 0-9
    (code >= 65 && code <= 90) || // A-Z
    (code >= 97 && code <= 122) || // a-z
    code === 95 || // _
    code === 36 // $
  );
}

/**
 * Parses the head of an `import` statement (everything between `import` and
 * `from`) and adds the bound identifier names to `names`.
 *
 * Handles:
 * - `import Foo from '...'` — default import
 * - `import * as Foo from '...'` — namespace import
 * - `import { Foo, Bar as Baz } from '...'` — named imports with aliases
 * - `import type { Foo } from '...'` and inline `type` specifiers
 * - any combination of the above
 */
function collectImportNames(head: string, names: Set<string>): void {
  // Strip an optional leading `type ` keyword from `import type ...`.
  let cursor = 0;
  while (cursor < head.length && isWhitespace(head.charCodeAt(cursor))) {
    cursor += 1;
  }
  if (head.startsWith('type', cursor) && isWhitespace(head.charCodeAt(cursor + 4))) {
    cursor += 4;
  }

  // Optional default name.
  while (cursor < head.length && isWhitespace(head.charCodeAt(cursor))) {
    cursor += 1;
  }
  const defaultMatch = LEADING_IDENTIFIER_REGEX.exec(head.slice(cursor));
  if (defaultMatch) {
    names.add(defaultMatch[1]);
    cursor += defaultMatch[1].length;
    while (cursor < head.length && isWhitespace(head.charCodeAt(cursor))) {
      cursor += 1;
    }
    if (head.charCodeAt(cursor) === 44 /* ',' */) {
      cursor += 1;
      while (cursor < head.length && isWhitespace(head.charCodeAt(cursor))) {
        cursor += 1;
      }
    }
  }

  // Optional namespace import: `* as Foo`.
  if (head.charCodeAt(cursor) === 42 /* '*' */) {
    cursor += 1;
    while (cursor < head.length && isWhitespace(head.charCodeAt(cursor))) {
      cursor += 1;
    }
    if (head.startsWith('as', cursor) && isWhitespace(head.charCodeAt(cursor + 2))) {
      cursor += 2;
      while (cursor < head.length && isWhitespace(head.charCodeAt(cursor))) {
        cursor += 1;
      }
      const namespaceMatch = LEADING_IDENTIFIER_REGEX.exec(head.slice(cursor));
      if (namespaceMatch) {
        names.add(namespaceMatch[1]);
        cursor += namespaceMatch[1].length;
      }
    }
  }

  // Optional named-imports block: `{ Foo, Bar as Baz }`.
  const openBrace = head.indexOf('{', cursor);
  if (openBrace === -1) {
    return;
  }
  const closeBrace = head.indexOf('}', openBrace + 1);
  if (closeBrace === -1) {
    return;
  }
  const namedBlock = head.slice(openBrace + 1, closeBrace);
  for (const part of namedBlock.split(',')) {
    const trimmed = stripLeadingType(part.trim());
    if (!trimmed) {
      continue;
    }
    // If there's an ` as ` alias, take the identifier after it; otherwise
    // take the identifier at the start. Splitting/searching with string
    // methods here avoids regex backtracking on whitespace-heavy specifiers.
    const aliasName = extractAliasName(trimmed);
    if (aliasName) {
      names.add(aliasName);
      continue;
    }
    const nameMatch = LEADING_IDENTIFIER_REGEX.exec(trimmed);
    if (nameMatch) {
      names.add(nameMatch[1]);
    }
  }
}

/**
 * Removes a leading `type ` keyword (followed by whitespace) from a named
 * import specifier such as `type Foo as Bar`.
 */
function stripLeadingType(specifier: string): string {
  if (
    specifier.startsWith('type') &&
    specifier.length > 4 &&
    isWhitespace(specifier.charCodeAt(4))
  ) {
    let index = 5;
    while (index < specifier.length && isWhitespace(specifier.charCodeAt(index))) {
      index += 1;
    }
    return specifier.slice(index);
  }
  return specifier;
}

/**
 * If the specifier contains an ` as ` alias clause, returns the alias name.
 * Returns `undefined` otherwise.
 */
function extractAliasName(specifier: string): string | undefined {
  // Walk forward looking for the literal token `as` surrounded by
  // whitespace on both sides. A linear scan keeps this O(n) regardless of
  // how many spaces or stray `as` substrings appear.
  for (let index = 1; index < specifier.length - 2; index += 1) {
    if (
      isWhitespace(specifier.charCodeAt(index)) &&
      specifier.charCodeAt(index + 1) === 97 /* 'a' */ &&
      specifier.charCodeAt(index + 2) === 115 /* 's' */ &&
      isWhitespace(specifier.charCodeAt(index + 3))
    ) {
      let cursor = index + 4;
      while (cursor < specifier.length && isWhitespace(specifier.charCodeAt(cursor))) {
        cursor += 1;
      }
      const aliasMatch = LEADING_IDENTIFIER_REGEX.exec(specifier.slice(cursor));
      if (aliasMatch) {
        return aliasMatch[1];
      }
    }
  }
  return undefined;
}

/**
 * True when `code` is a whitespace character (space, tab, newline, carriage
 * return, form feed, or NaN/undefined which we treat as boundary).
 */
function isWhitespace(code: number): boolean {
  return code === 32 || code === 9 || code === 10 || code === 13 || code === 12;
}
