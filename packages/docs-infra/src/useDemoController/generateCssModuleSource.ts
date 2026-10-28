/**
 * Reserved words that cannot be bound by `export const <name>` in a module
 * (modules are always strict mode). Such class names are still reachable through
 * the default-export object, just not as a named export.
 */
const RESERVED_WORDS = new Set([
  'break',
  'case',
  'catch',
  'class',
  'const',
  'continue',
  'debugger',
  'default',
  'delete',
  'do',
  'else',
  'enum',
  'export',
  'extends',
  'false',
  'finally',
  'for',
  'function',
  'if',
  'import',
  'in',
  'instanceof',
  'new',
  'null',
  'return',
  'super',
  'switch',
  'this',
  'throw',
  'true',
  'try',
  'typeof',
  'var',
  'void',
  'while',
  'with',
  'implements',
  'interface',
  'let',
  'package',
  'private',
  'protected',
  'public',
  'static',
  'yield',
  'await',
  'eval',
  'arguments',
]);

/** Whether `name` is a (conservative, ASCII) JavaScript identifier. */
function isJsIdentifier(name: string): boolean {
  if (name.length === 0) {
    return false;
  }
  for (let index = 0; index < name.length; index += 1) {
    const code = name.charCodeAt(index);
    const isLetter = (code >= 97 && code <= 122) || (code >= 65 && code <= 90);
    const isUnderscoreOrDollar = code === 95 || code === 36;
    const isDigit = code >= 48 && code <= 57;
    if (!(isLetter || isUnderscoreOrDollar || (index > 0 && isDigit))) {
      return false;
    }
  }
  return true;
}

/** Wraps a value in a single-quoted JS string literal, escaping it safely. */
function quote(value: string): string {
  const escaped = value
    .replaceAll('\\', '\\\\')
    .replaceAll("'", "\\'")
    .replaceAll('\n', '\\n')
    .replaceAll('\r', '\\r')
    // U+2028/U+2029 are line terminators that were illegal in pre-ES2019 string
    // literals; escape them so the generated source stays valid for any input.
    .replaceAll('\u2028', '\\u2028')
    .replaceAll('\u2029', '\\u2029');
  return `'${escaped}'`;
}

/**
 * Serializes a CSS module's class-name exports into ESM source text — the
 * optional companion to `compileCssModule` for when a literal JS string is
 * needed (to display in a source viewer, or to run a `.module.css` file through
 * the same `importCode` path as `.ts`/`.js` files).
 *
 * Emits a named export for every identifier-safe class name and a default export
 * object containing all of them (so hyphenated names like `my-button` remain
 * reachable via `styles['my-button']`).
 */
export function generateCssModuleSource(exports: Record<string, string>): string {
  const entries = Object.entries(exports);
  const lines: string[] = [];

  for (const [local, scoped] of entries) {
    if (isJsIdentifier(local) && !RESERVED_WORDS.has(local)) {
      lines.push(`export const ${local} = ${quote(scoped)};`);
    }
  }

  const objectBody = entries
    .map(([local, scoped]) => `${quote(local)}: ${quote(scoped)}`)
    .join(', ');
  lines.push(`export default {${objectBody ? ` ${objectBody} ` : ''}};`);

  return `${lines.join('\n')}\n`;
}
