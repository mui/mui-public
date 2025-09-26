// webpack does not like node: imports
// eslint-disable-next-line n/prefer-node-protocol
import path from 'path';

export interface ImportName {
  name: string;
  alias?: string;
  type: 'default' | 'named' | 'namespace';
  isType?: boolean;
}

export interface RelativeImport {
  path: string;
  names: ImportName[];
  includeTypeDefs?: true;
}

export interface ExternalImport {
  names: ImportName[];
}

export interface ParseImportsResult {
  relative: Record<string, RelativeImport>;
  externals: Record<string, ExternalImport>;
}

export async function parseImports(code: string, filePath: string): Promise<ParseImportsResult> {
  const result: Record<string, RelativeImport> = {};
  const externals: Record<string, ExternalImport> = {};

  // Check if this is a CSS file
  const isCssFile = filePath.toLowerCase().endsWith('.css');

  // Helper to check if a char is a quote
  function isQuote(ch: string) {
    return ch === '"' || ch === "'" || ch === '`';
  }

  // Generic function to scan code and find import statements
  function scanForImports(
    sourceCode: string,
    importDetector: (
      code: string,
      pos: number,
    ) => { found: boolean; nextPos: number; statement?: any },
  ): any[] {
    const statements: any[] = [];
    let i = 0;
    const len = sourceCode.length;
    let state: 'code' | 'singleline-comment' | 'multiline-comment' | 'string' | 'template' = 'code';
    let stringQuote: string | null = null;

    while (i < len) {
      const ch = sourceCode[i];
      const next = sourceCode[i + 1];

      if (state === 'code') {
        // Start of single-line comment
        if (ch === '/' && next === '/') {
          state = 'singleline-comment';
          i += 2;
          continue;
        }
        // Start of multi-line comment
        if (ch === '/' && next === '*') {
          state = 'multiline-comment';
          i += 2;
          continue;
        }
        // Start of string
        if (isQuote(ch)) {
          state = ch === '`' ? 'template' : 'string';
          stringQuote = ch;
          i += 1;
          continue;
        }

        // Use the provided import detector
        const detection = importDetector(sourceCode, i);
        if (detection.found) {
          if (detection.statement) {
            statements.push(detection.statement);
          }
          i = detection.nextPos;
          continue;
        }

        i += 1;
        continue;
      }
      if (state === 'singleline-comment') {
        if (ch === '\n') {
          state = 'code';
        }
        i += 1;
        continue;
      }
      if (state === 'multiline-comment') {
        if (ch === '*' && next === '/') {
          state = 'code';
          i += 2;
          continue;
        }
        i += 1;
        continue;
      }
      if (state === 'string') {
        if (ch === '\\') {
          i += 2;
          continue;
        }
        if (ch === stringQuote) {
          state = 'code';
          stringQuote = null;
        }
        i += 1;
        continue;
      }
      if (state === 'template') {
        if (ch === '`') {
          state = 'code';
          stringQuote = null;
          i += 1;
          continue;
        }
        if (ch === '\\') {
          i += 2;
          continue;
        }
        i += 1;
        continue;
      }
      i += 1;
    }

    return statements;
  }

  // Function to parse CSS @import statements
  function parseCssImports(
    cssCode: string,
    cssFilePath: string,
    cssResult: Record<string, RelativeImport>,
    cssExternals: Record<string, ExternalImport>,
  ): ParseImportsResult {
    // CSS import detector function
    function detectCssImport(sourceText: string, pos: number) {
      const ch = sourceText[pos];

      // Look for '@import' keyword
      if (
        ch === '@' &&
        sourceText.slice(pos, pos + 7) === '@import' &&
        /\s/.test(sourceText[pos + 7] || '')
      ) {
        // Parse the @import statement
        const importResult = parseCssImportStatement(sourceText, pos);
        if (importResult.modulePath) {
          // In CSS, imports are relative unless they have a protocol/hostname
          // Examples of external: "http://...", "https://...", "//example.com/style.css"
          // Examples of relative: "print.css", "./local.css", "../parent.css"
          const hasProtocol = /^https?:\/\//.test(importResult.modulePath);
          const hasHostname = /^\/\//.test(importResult.modulePath);
          const isExternal = hasProtocol || hasHostname;

          if (isExternal) {
            if (!cssExternals[importResult.modulePath]) {
              cssExternals[importResult.modulePath] = { names: [] };
            }
          } else {
            // Treat as relative import - normalize the path if it doesn't start with ./ or ../
            let normalizedPath = importResult.modulePath;
            if (!normalizedPath.startsWith('./') && !normalizedPath.startsWith('../')) {
              normalizedPath = `./${normalizedPath}`;
            }
            const resolvedPath = path.resolve(path.dirname(cssFilePath), normalizedPath);
            if (!cssResult[importResult.modulePath]) {
              cssResult[importResult.modulePath] = { path: resolvedPath, names: [] };
            }
          }
        }
        return { found: true, nextPos: importResult.nextPos };
      }

      return { found: false, nextPos: pos };
    }

    // Use the generic scanner
    scanForImports(cssCode, detectCssImport);

    return { relative: cssResult, externals: cssExternals };
  }

  // Function to parse a single CSS @import statement
  function parseCssImportStatement(
    cssCode: string,
    start: number,
  ): { modulePath: string | null; nextPos: number } {
    let pos = start + 7; // Skip '@import'
    const len = cssCode.length;

    // Skip whitespace
    while (pos < len && /\s/.test(cssCode[pos])) {
      pos += 1;
    }

    let modulePath: string | null = null;

    // Check for url() syntax
    if (cssCode.slice(pos, pos + 4) === 'url(') {
      pos += 4;
      // Skip whitespace
      while (pos < len && /\s/.test(cssCode[pos])) {
        pos += 1;
      }

      // Read the URL (quoted or unquoted)
      if (pos < len && (cssCode[pos] === '"' || cssCode[pos] === "'")) {
        const quote = cssCode[pos];
        pos += 1;
        let url = '';
        while (pos < len && cssCode[pos] !== quote) {
          // Only stop at newlines - parentheses and semicolons are valid in URLs
          if (cssCode[pos] === '\n') {
            break;
          }
          if (cssCode[pos] === '\\') {
            pos += 2;
            continue;
          }
          url += cssCode[pos];
          pos += 1;
        }
        if (pos < len && cssCode[pos] === quote) {
          pos += 1;
          modulePath = url;
        }
        // If we didn't find the closing quote, don't set modulePath (malformed)
      } else {
        // Unquoted URL
        let url = '';
        while (pos < len && cssCode[pos] !== ')' && !/\s/.test(cssCode[pos])) {
          url += cssCode[pos];
          pos += 1;
        }
        modulePath = url;
      }

      // Skip to closing parenthesis - if we don't find it, the url() is malformed
      while (pos < len && cssCode[pos] !== ')' && cssCode[pos] !== ';' && cssCode[pos] !== '\n') {
        pos += 1;
      }
      if (pos < len && cssCode[pos] === ')') {
        pos += 1;
        // Only consider this a valid URL if we found the closing parenthesis
      } else {
        // Malformed url() - don't set modulePath
        modulePath = null;
      }
    } else if (pos < len && (cssCode[pos] === '"' || cssCode[pos] === "'")) {
      // Direct quoted import
      const quote = cssCode[pos];
      pos += 1;
      let url = '';
      while (pos < len && cssCode[pos] !== quote) {
        // Stop if we hit a newline (likely malformed), but semicolons are valid in URLs
        if (cssCode[pos] === '\n') {
          break;
        }
        if (cssCode[pos] === '\\') {
          pos += 2;
          continue;
        }
        url += cssCode[pos];
        pos += 1;
      }
      if (pos < len && cssCode[pos] === quote) {
        pos += 1;
        modulePath = url;
      }
      // If we didn't find the closing quote, don't set modulePath (malformed import)
    }

    // Skip to semicolon or end of statement
    while (pos < len && cssCode[pos] !== ';' && cssCode[pos] !== '\n') {
      pos += 1;
    }
    if (pos < len && cssCode[pos] === ';') {
      pos += 1;
    }

    return { modulePath, nextPos: pos };
  }

  // If this is a CSS file, parse CSS @import statements instead
  if (isCssFile) {
    return parseCssImports(code, filePath, result, externals);
  }

  // JavaScript import detector function
  function detectJavaScriptImport(sourceText: string, pos: number) {
    const ch = sourceText[pos];

    // Look for 'import' keyword (not part of an identifier, and not preceded by @)
    if (
      ch === 'i' &&
      sourceText.slice(pos, pos + 6) === 'import' &&
      (pos === 0 || /[^a-zA-Z0-9_$@]/.test(sourceText[pos - 1])) &&
      /[^a-zA-Z0-9_$]/.test(sourceText[pos + 6] || '')
    ) {
      // Mark start of import statement
      const importStart = pos;
      const len = sourceText.length;

      // Now, scan forward to find the end of the statement (semicolon or proper end for side-effect imports)
      let j = pos + 6;
      let importState: 'code' | 'string' | 'template' = 'code';
      let importQuote: string | null = null;
      let braceDepth = 0;
      let foundFrom = false;
      let foundModulePath = false;

      while (j < len) {
        const cj = sourceText[j];
        if (importState === 'code') {
          if (cj === ';') {
            j += 1;
            break;
          }
          // Check if we're at a bare import statement (no 'from')
          if (cj === '\n' && !foundFrom && !foundModulePath && braceDepth === 0) {
            // This might be a side-effect import or end of statement
            // Look ahead to see if there's content that could be part of the import
            let k = j + 1;
            while (k < len && /\s/.test(sourceText[k])) {
              k += 1;
            }
            if (k >= len || sourceText.slice(k, k + 4) === 'from' || isQuote(sourceText[k])) {
              // Continue, this newline is within the import
            } else {
              // This looks like the end of a side-effect import
              j += 1;
              break;
            }
          }
          if (isQuote(cj)) {
            importState = cj === '`' ? 'template' : 'string';
            importQuote = cj;
            if (foundFrom) {
              foundModulePath = true;
            }
            j += 1;
            continue;
          }
          if (cj === '{') {
            braceDepth += 1;
          }
          if (cj === '}') {
            braceDepth -= 1;
          }
          if (sourceText.slice(j, j + 4) === 'from' && /\s/.test(sourceText[j + 4] || '')) {
            foundFrom = true;
          }
          // If we found a module path and we're back to normal code, we might be done
          if (foundModulePath && braceDepth === 0 && /\s/.test(cj)) {
            // Look ahead for semicolon or end of statement
            let k = j;
            while (k < len && /\s/.test(sourceText[k])) {
              k += 1;
            }
            if (k >= len || sourceText[k] === ';' || sourceText[k] === '\n') {
              if (sourceText[k] === ';') {
                j = k + 1;
              } else {
                j = k;
              }
              break;
            }
          }
        } else if (importState === 'string') {
          if (cj === '\\') {
            j += 2;
            continue;
          }
          if (cj === importQuote) {
            importState = 'code';
            importQuote = null;
          }
          j += 1;
          continue;
        } else if (importState === 'template') {
          if (cj === '`') {
            importState = 'code';
            importQuote = null;
          } else if (cj === '\\') {
            j += 2;
            continue;
          }
          j += 1;
          continue;
        }
        j += 1;
      }

      const importText = sourceText.slice(importStart, j);
      return {
        found: true,
        nextPos: j,
        statement: { start: importStart, end: j, text: importText },
      };
    }

    return { found: false, nextPos: pos };
  }

  // Scan code for JavaScript import statements
  const importStatements = scanForImports(code, detectJavaScriptImport);

  // Helper function to add import name if it doesn't exist
  function addImportName(
    target: ImportName[],
    name: string,
    type: 'default' | 'named' | 'namespace',
    alias?: string,
    isType?: boolean,
  ) {
    const existing = target.find((n) => n.name === name && n.type === type && n.alias === alias);
    if (!existing) {
      target.push({
        name,
        ...(alias && { alias }),
        type,
        ...(isType && { isType: true }),
      });
    }
  }

  // Helper function to check if a character is a valid identifier character
  function isIdentifierChar(ch: string): boolean {
    return /[a-zA-Z0-9_$]/.test(ch);
  }

  // Helper function to check if a character is whitespace
  function isWhitespace(ch: string): boolean {
    return /\s/.test(ch);
  }

  // Helper function to skip whitespace and return the next non-whitespace position
  function skipWhitespace(text: string, start: number): number {
    let pos = start;
    while (pos < text.length && isWhitespace(text[pos])) {
      pos += 1;
    }
    return pos;
  }

  // Helper function to read an identifier starting at position
  function readIdentifier(text: string, start: number): { name: string; nextPos: number } {
    let pos = start;
    let name = '';

    // First character must be letter, underscore, or dollar sign
    if (pos < text.length && /[a-zA-Z_$]/.test(text[pos])) {
      name += text[pos];
      pos += 1;

      // Subsequent characters can be letters, digits, underscore, or dollar sign
      while (pos < text.length && isIdentifierChar(text[pos])) {
        name += text[pos];
        pos += 1;
      }
    }

    return { name, nextPos: pos };
  }

  // Helper function to read a quoted string starting at position
  function readQuotedString(text: string, start: number): { value: string; nextPos: number } {
    const quote = text[start];
    let pos = start + 1;
    let value = '';

    while (pos < text.length) {
      const ch = text[pos];
      if (ch === '\\' && pos + 1 < text.length) {
        // Skip escaped character
        pos += 2;
        continue;
      }
      if (ch === quote) {
        pos += 1;
        break;
      }
      value += ch;
      pos += 1;
    }

    return { value, nextPos: pos };
  }

  // Helper function to parse named imports from a brace-enclosed section
  function parseNamedImports(
    text: string,
    start: number,
    end: number,
  ): Array<{ name: string; alias?: string; isType?: boolean }> {
    const imports: Array<{ name: string; alias?: string; isType?: boolean }> = [];
    let pos = start;

    while (pos < end) {
      pos = skipWhitespace(text, pos);
      if (pos >= end) {
        break;
      }

      // Handle comments within named imports
      if (pos + 1 < end && text[pos] === '/' && text[pos + 1] === '/') {
        // Skip single-line comment
        while (pos < end && text[pos] !== '\n') {
          pos += 1;
        }
        continue;
      }

      if (pos + 1 < end && text[pos] === '/' && text[pos + 1] === '*') {
        // Skip multi-line comment
        pos += 2;
        while (pos + 1 < end) {
          if (text[pos] === '*' && text[pos + 1] === '/') {
            pos += 2;
            break;
          }
          pos += 1;
        }
        continue;
      }

      // Skip comma if we encounter it
      if (text[pos] === ',') {
        pos += 1;
        continue;
      }

      // Check for 'type' keyword
      let isTypeImport = false;
      if (text.slice(pos, pos + 4) === 'type' && !isIdentifierChar(text[pos + 4] || '')) {
        isTypeImport = true;
        pos += 4;
        pos = skipWhitespace(text, pos);
      }

      // Read the import name
      const { name, nextPos } = readIdentifier(text, pos);
      if (!name) {
        pos += 1;
        continue;
      }
      pos = nextPos;

      pos = skipWhitespace(text, pos);

      // Check for 'as' keyword (alias)
      let alias: string | undefined;
      if (text.slice(pos, pos + 2) === 'as' && !isIdentifierChar(text[pos + 2] || '')) {
        pos += 2;
        pos = skipWhitespace(text, pos);
        const aliasResult = readIdentifier(text, pos);
        alias = aliasResult.name;
        pos = aliasResult.nextPos;
        pos = skipWhitespace(text, pos);
      }

      imports.push({ name, ...(alias && { alias }), ...(isTypeImport && { isType: true }) });

      // Skip comma if present
      if (text[pos] === ',') {
        pos += 1;
      }
    }

    return imports;
  }

  // Now, parse each import statement using character-by-character parsing
  for (const { text } of importStatements) {
    let pos = 0;
    const textLen = text.length;

    // Skip 'import'
    pos = 6; // We know it starts with 'import'
    pos = skipWhitespace(text, pos);

    // Check for 'type' keyword
    let isTypeImport = false;
    if (text.slice(pos, pos + 4) === 'type' && !isIdentifierChar(text[pos + 4] || '')) {
      isTypeImport = true;
      pos += 4;
      pos = skipWhitespace(text, pos);
    }

    // Check if this is a side-effect import (starts with quote)
    if (pos < textLen && isQuote(text[pos])) {
      const { value: modulePath } = readQuotedString(text, pos);
      if (modulePath) {
        const isRelative = modulePath.startsWith('./') || modulePath.startsWith('../');
        if (isRelative) {
          const resolvedPath = path.resolve(path.dirname(filePath), modulePath);
          if (!result[modulePath]) {
            result[modulePath] = { path: resolvedPath, names: [] };
          }
        } else if (!externals[modulePath]) {
          externals[modulePath] = { names: [] };
        }
      }
      continue;
    }

    // Parse import specifiers
    let defaultImport: string | undefined;
    let namespaceImport: string | undefined;
    let namedImports: Array<{ name: string; alias?: string; isType?: boolean }> = [];

    // Check for default import (identifier not followed by 'from')
    if (pos < textLen && /[a-zA-Z_$]/.test(text[pos])) {
      const { name, nextPos } = readIdentifier(text, pos);
      const afterName = skipWhitespace(text, nextPos);

      // If next non-whitespace is comma or 'from', this is a default import
      if (
        afterName >= textLen ||
        text[afterName] === ',' ||
        text.slice(afterName, afterName + 4) === 'from'
      ) {
        defaultImport = name;
        pos = afterName;

        // Skip comma if present
        if (pos < textLen && text[pos] === ',') {
          pos += 1;
          pos = skipWhitespace(text, pos);
        }
      }
    }

    // Check for namespace import (* as Name)
    if (pos < textLen && text[pos] === '*') {
      pos += 1;
      pos = skipWhitespace(text, pos);

      // Expect 'as'
      if (text.slice(pos, pos + 2) === 'as') {
        pos += 2;
        pos = skipWhitespace(text, pos);

        const { name } = readIdentifier(text, pos);
        if (name) {
          namespaceImport = name;
          pos = readIdentifier(text, pos).nextPos;
          pos = skipWhitespace(text, pos);
        }
      }
    }

    // Check for named imports ({ ... })
    if (pos < textLen && text[pos] === '{') {
      pos += 1;
      const braceStart = pos;

      // Find the closing brace
      let braceDepth = 1;
      while (pos < textLen && braceDepth > 0) {
        if (text[pos] === '{') {
          braceDepth += 1;
        } else if (text[pos] === '}') {
          braceDepth -= 1;
        }
        pos += 1;
      }

      if (braceDepth === 0) {
        const braceEnd = pos - 1;
        namedImports = parseNamedImports(text, braceStart, braceEnd);
      }
    }

    // Skip to 'from' keyword
    pos = skipWhitespace(text, pos);
    while (pos < textLen && text.slice(pos, pos + 4) !== 'from') {
      pos += 1;
    }

    if (pos >= textLen || text.slice(pos, pos + 4) !== 'from') {
      continue; // No 'from' found, skip this import
    }

    pos += 4;
    pos = skipWhitespace(text, pos);

    // Read module path
    if (pos >= textLen || !isQuote(text[pos])) {
      continue; // No quoted module path found
    }

    const { value: modulePath } = readQuotedString(text, pos);
    if (!modulePath) {
      continue;
    }

    const isRelative = modulePath.startsWith('./') || modulePath.startsWith('../');

    if (isRelative) {
      const resolvedPath = path.resolve(path.dirname(filePath), modulePath);
      if (!result[modulePath]) {
        result[modulePath] = {
          path: resolvedPath,
          names: [],
          ...(isTypeImport && { includeTypeDefs: true as const }),
        };
      } else if (isTypeImport && !result[modulePath].includeTypeDefs) {
        result[modulePath].includeTypeDefs = true as const;
      }

      if (defaultImport) {
        addImportName(result[modulePath].names, defaultImport, 'default', undefined, isTypeImport);
      }

      if (namespaceImport) {
        addImportName(
          result[modulePath].names,
          namespaceImport,
          'namespace',
          undefined,
          isTypeImport,
        );
      }

      namedImports.forEach(({ name, alias, isType }) => {
        addImportName(result[modulePath].names, name, 'named', alias, isTypeImport || isType);
      });
    } else {
      if (!externals[modulePath]) {
        externals[modulePath] = { names: [] };
      }

      if (defaultImport) {
        addImportName(
          externals[modulePath].names,
          defaultImport,
          'default',
          undefined,
          isTypeImport,
        );
      }

      if (namespaceImport) {
        addImportName(
          externals[modulePath].names,
          namespaceImport,
          'namespace',
          undefined,
          isTypeImport,
        );
      }

      namedImports.forEach(({ name, alias, isType }) => {
        addImportName(externals[modulePath].names, name, 'named', alias, isTypeImport || isType);
      });
    }
  }

  return { relative: result, externals };
}
