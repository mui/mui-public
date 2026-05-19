/**
 * Utility function for parsing function arguments and handling nested structures
 * in JavaScript/TypeScript code with structured representations.
 */

/**
 * Structured argument types for discriminating between different code constructs:
 * - `[Array]`: Literal array - e.g., `['1', '2', '3']`
 * - `[String, Array]`: Function call - e.g., `['func', ['a', 'b']]`
 * - `[String, Array, Array]`: Function with generics - e.g., `['Component', [{ foo: 'string' }], []]`
 * - `[String, Array, null]`: Type with generics - e.g., `['Theme', ['"dark" | "light"'], null]`
 * - `[Array, any]`: Simple arrow function - e.g., `[['evt'], 'evt.preventDefault()']`
 * - `[Array, [any, any], any]`: Typed arrow function - e.g., `[['data'], ['string', 'Promise<string>'], ['Promise.resolve', ['data']]]`
 * - `['as', string, any]`: TypeScript type assertion - e.g., `['as', 'React.FC<Props>', 'Component']`
 * - `Record<string, any>`: Object literal - e.g., `{ key: 'value' }`
 * - `string`: Plain string value
 */
export type SplitArguments = Array<string | SplitArguments | Record<string, any>>;

/**
 * Type guard and extractor for literal arrays
 * @param value - The value to check
 * @returns Object with items array if it's a literal array, false otherwise
 */
export function isArray(value: any): { items: any[] } | false {
  if (Array.isArray(value) && value.length === 1 && Array.isArray(value[0])) {
    return { items: value };
  }
  return false;
}

/**
 * Type guard and extractor for function calls
 * @param value - The value to check
 * @returns Object with name and arguments if it's a function call, false otherwise
 */
export function isFunction(value: any): { name: string; arguments: any[] } | false {
  if (
    Array.isArray(value) &&
    value.length === 2 &&
    typeof value[0] === 'string' &&
    Array.isArray(value[1])
  ) {
    return { name: value[0], arguments: value[1] };
  }
  return false;
}

/**
 * Type guard and extractor for generics (both function and type generics)
 * @param value - The value to check
 * @returns Object with name, generics, and arguments (or null for types) if it's a generic, false otherwise
 */
export function isGeneric(
  value: any,
): { name: string; generics: any[]; arguments: any[] | null } | false {
  if (
    Array.isArray(value) &&
    value.length === 3 &&
    typeof value[0] === 'string' &&
    Array.isArray(value[1])
  ) {
    return { name: value[0], generics: value[1], arguments: value[2] };
  }
  return false;
}

/**
 * Type guard and extractor for arrow functions
 * @param value - The value to check
 * @returns Object with args, types (if typed), and returnValue if it's an arrow function, false otherwise
 */
export function isArrowFunction(
  value: any,
): { args: any[]; types?: [any, any]; returnValue: any } | false {
  if (Array.isArray(value) && Array.isArray(value[0])) {
    if (value.length === 2) {
      // Simple arrow function: [Array, any]
      return { args: value[0], returnValue: value[1] };
    }
    if (value.length === 3 && Array.isArray(value[1]) && value[1].length === 2) {
      // Typed arrow function: [Array, [inputTypes, outputTypes], any]
      return { args: value[0], types: [value[1][0], value[1][1]], returnValue: value[2] };
    }
  }
  return false;
}

/**
 * Type guard and extractor for object literals
 * @param value - The value to check
 * @returns Object with properties if it's an object literal, false otherwise
 */
export function isObjectLiteral(value: any): { properties: Record<string, any> } | false {
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    return { properties: value };
  }
  return false;
}

/**
 * Type guard and extractor for TypeScript type assertions
 * @param value - The value to check
 * @returns Object with type and expression if it's a type assertion, false otherwise
 */
export function isTypeAssertion(value: any): { type: string; expression: any } | false {
  if (
    Array.isArray(value) &&
    value.length === 3 &&
    value[0] === 'as' &&
    typeof value[1] === 'string'
  ) {
    return { type: value[1], expression: value[2] };
  }
  return false;
}

/**
 * Main API: Parse arguments and return structured representation
 * This is the primary parsing function optimized for recursive data structures
 */
export function parseFunctionArguments(str: string): SplitArguments {
  return parseArgumentsRecursive(str);
}

/**
 * Parse entire file and extract all exports with their function calls
 * Returns a mapping of export names to their function call information
 */
export function parseFileExports(
  fileContent: string,
): Record<
  string,
  { functionName: string; arguments: SplitArguments; sourceRange: [number, number] }
> {
  const exports: Record<
    string,
    { functionName: string; arguments: SplitArguments; sourceRange: [number, number] }
  > = {};

  // Find all export statements that assign function calls
  const exportRegex = /export\s+const\s+(\w+)\s*=\s*(\w+)\s*\(/g;
  let match = exportRegex.exec(fileContent);

  while (match !== null) {
    const exportName = match[1];
    const functionName = match[2];
    const callStartIndex = match.index;
    const parenIndex = match.index + match[0].length - 1; // Position of opening parenthesis

    // Find the matching closing parenthesis
    let parenCount = 0;
    let callEndIndex = -1;

    for (let i = parenIndex; i < fileContent.length; i += 1) {
      if (fileContent[i] === '(') {
        parenCount += 1;
      } else if (fileContent[i] === ')') {
        parenCount -= 1;
        if (parenCount === 0) {
          callEndIndex = i;
          break;
        }
      }
    }

    if (callEndIndex !== -1) {
      // Extract the arguments content between parentheses
      const argumentsContent = fileContent.substring(parenIndex + 1, callEndIndex);

      exports[exportName] = {
        functionName,
        // Parse the arguments using existing logic
        arguments: parseFunctionArguments(argumentsContent),
        sourceRange: [callStartIndex, callEndIndex + 1],
      };
    }

    match = exportRegex.exec(fileContent);
  }

  return exports;
}

/**
 * Internal recursive parsing function
 */
function parseArgumentsRecursive(str: string): SplitArguments {
  const result: SplitArguments = [];
  let current = '';
  let parenCount = 0;
  let braceCount = 0;
  let bracketCount = 0;
  let angleCount = 0;
  let inSingleLineComment = false;
  let inMultiLineComment = false;
  let inString = false;
  let stringChar = '';

  for (let i = 0; i < str.length; i += 1) {
    const char = str[i];
    const nextChar = str[i + 1];

    // Handle comments
    if (!inString && !inSingleLineComment && !inMultiLineComment) {
      if (char === '/' && nextChar === '/') {
        inSingleLineComment = true;
        current += char;
        continue;
      }
      if (char === '/' && nextChar === '*') {
        inMultiLineComment = true;
        current += char;
        continue;
      }
    }

    if (inSingleLineComment && char === '\n') {
      inSingleLineComment = false;
      current += char;
      continue;
    }

    if (inMultiLineComment && char === '*' && nextChar === '/') {
      inMultiLineComment = false;
      current += char + nextChar;
      i += 1; // Skip next character
      continue;
    }

    if (inSingleLineComment || inMultiLineComment) {
      current += char;
      continue;
    }

    // Handle strings
    if (!inString && (char === '"' || char === "'" || char === '`')) {
      inString = true;
      stringChar = char;
      current += char;
      continue;
    }

    if (inString && char === stringChar && str[i - 1] !== '\\') {
      inString = false;
      stringChar = '';
      current += char;
      continue;
    }

    if (inString) {
      current += char;
      continue;
    }

    // Handle brackets and parentheses
    if (char === '(') {
      parenCount += 1;
    } else if (char === ')') {
      parenCount -= 1;
    } else if (char === '{') {
      braceCount += 1;
    } else if (char === '}') {
      braceCount -= 1;
    } else if (char === '[') {
      bracketCount += 1;
    } else if (char === ']') {
      bracketCount -= 1;
    } else if (char === '<') {
      angleCount += 1;
    } else if (char === '>' && str[i - 1] !== '=') {
      // Only count > as closing angle bracket if it's not part of =>
      angleCount -= 1;
    } else if (
      char === ',' &&
      parenCount === 0 &&
      braceCount === 0 &&
      bracketCount === 0 &&
      angleCount === 0
    ) {
      const trimmedPart = current.trim();
      if (trimmedPart) {
        result.push(parseElement(trimmedPart));
      }
      current = '';
      continue;
    }

    current += char;
  }

  // Handle the last part
  if (current.trim()) {
    const trimmedPart = current.trim();
    result.push(parseElement(trimmedPart));
  }

  return result;
}

/**
 * Parse a single element and determine its type/structure
 */
function parseElement(element: string): any {
  let trimmed = element.trim();

  // Remove comments
  trimmed = removeComments(trimmed);

  // Handle object literals FIRST before checking for 'as'
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    return parseObjectLiteral(trimmed);
  }

  // Handle TypeScript 'as' type assertions with structured representation
  if (trimmed.includes(' as ')) {
    return parseTypeAssertion(trimmed);
  }

  // Handle array literals
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    return parseArrayLiteral(trimmed);
  }

  // Handle arrow functions
  if (trimmed.includes('=>')) {
    return parseArrowFunction(trimmed);
  }

  // Handle function calls and generics
  if (trimmed.includes('(') || trimmed.includes('<')) {
    return parseFunctionOrGeneric(trimmed);
  }

  // Everything else is just a string
  return trimmed;
}

/**
 * Remove comments from a string
 */
function removeComments(str: string): string {
  let result = '';
  let inSingleLineComment = false;
  let inMultiLineComment = false;
  let inString = false;
  let stringChar = '';

  for (let i = 0; i < str.length; i += 1) {
    const char = str[i];
    const nextChar = str[i + 1];

    // Handle strings first
    if (
      !inSingleLineComment &&
      !inMultiLineComment &&
      !inString &&
      (char === '"' || char === "'" || char === '`')
    ) {
      inString = true;
      stringChar = char;
      result += char;
      continue;
    }

    if (inString && char === stringChar && str[i - 1] !== '\\') {
      inString = false;
      stringChar = '';
      result += char;
      continue;
    }

    if (inString) {
      result += char;
      continue;
    }

    // Handle comments
    if (!inSingleLineComment && !inMultiLineComment) {
      if (char === '/' && nextChar === '/') {
        inSingleLineComment = true;
        i += 1; // Skip next character
        continue;
      }
      if (char === '/' && nextChar === '*') {
        inMultiLineComment = true;
        i += 1; // Skip next character
        continue;
      }
    }

    if (inSingleLineComment && char === '\n') {
      inSingleLineComment = false;
      result += char;
      continue;
    }

    if (inMultiLineComment && char === '*' && nextChar === '/') {
      inMultiLineComment = false;
      i += 1; // Skip next character
      continue;
    }

    if (inSingleLineComment || inMultiLineComment) {
      continue;
    }

    result += char;
  }

  return result.trim();
}

/**
 * Parse object literal like { key: value, other: data }
 */
function parseObjectLiteral(str: string): Record<string, any> {
  const content = str.slice(1, -1).trim(); // Remove { }
  if (!content) {
    return {};
  }

  const obj: Record<string, any> = {};

  // Parse object properties manually to handle complex types
  const properties = parseObjectProperties(content);

  for (const prop of properties) {
    const colonIndex = prop.indexOf(':');
    if (colonIndex !== -1) {
      const key = prop.substring(0, colonIndex).trim();
      const value = prop.substring(colonIndex + 1).trim();
      // Parse the value
      const parsedValue = parseElement(value);

      // For object properties: preserve strings as-is, but only wrap array LITERALS in another array
      if (typeof parsedValue === 'string' && !Array.isArray(parsedValue)) {
        obj[key] = parsedValue;
      } else if (Array.isArray(parsedValue)) {
        // Only double-wrap array literals (parsed from [1, 2, 3])
        // Functions and generics should remain as single arrays
        const originalValue = value.trim();
        if (originalValue.startsWith('[') && originalValue.endsWith(']')) {
          // This is an array literal - double wrap it
          obj[key] = [parsedValue];
        } else {
          // This is a function call or generic - keep as single array
          obj[key] = parsedValue;
        }
      } else {
        obj[key] = parsedValue;
      }
    } else {
      // Shorthand property like { foo } -> { foo: 'foo' }
      const trimmed = prop.trim();
      obj[trimmed] = trimmed;
    }
  }

  return obj;
}

/**
 * Parse object properties, handling complex nested types
 */
function parseObjectProperties(content: string): string[] {
  const properties: string[] = [];
  let current = '';
  let depth = 0;
  let inString = false;
  let stringChar = '';

  for (let i = 0; i < content.length; i += 1) {
    const char = content[i];
    const nextChar = content[i + 1];

    if (!inString && (char === '"' || char === "'" || char === '`')) {
      inString = true;
      stringChar = char;
    } else if (inString && char === stringChar && content[i - 1] !== '\\') {
      inString = false;
      stringChar = '';
    }

    if (!inString) {
      if (char === '<' || char === '{' || char === '(' || char === '[') {
        depth += 1;
      } else if (char === '>' && nextChar !== '=' && content[i - 1] !== '=') {
        // Only count > as closing bracket if it's not part of => or >=
        depth -= 1;
      } else if (char === '}' || char === ')' || char === ']') {
        depth -= 1;
      } else if (char === ',' && depth === 0) {
        if (current.trim()) {
          properties.push(current.trim());
        }
        current = '';
        continue;
      }
    }

    current += char;
  }

  if (current.trim()) {
    properties.push(current.trim());
  }

  return properties;
}

/**
 * Parse array literal like [1, 2, 3]
 */
function parseArrayLiteral(str: string): any[] {
  const content = str.slice(1, -1).trim(); // Remove [ ]
  if (!content) {
    return [];
  }

  return parseArgumentsRecursive(content);
}

/**
 * Parse arrow function like (a) => a + 1 or (data: string): Promise<string> => Promise.resolve(data)
 */
function parseArrowFunction(str: string): any[] {
  const arrowIndex = str.indexOf('=>');
  const leftPart = str.substring(0, arrowIndex).trim();
  const rightPart = str.substring(arrowIndex + 2).trim();

  // Parse arguments
  let args: any[] = [];
  let types: [any, any] | undefined;

  if (leftPart.startsWith('(') && leftPart.includes(')')) {
    const parenEnd = leftPart.lastIndexOf(')');
    const argsPart = leftPart.substring(1, parenEnd);
    const afterParen = leftPart.substring(parenEnd + 1).trim();

    args = argsPart ? parseArgumentsRecursive(argsPart) : [];

    // Check for return type annotation
    if (afterParen.startsWith(':')) {
      const returnType = afterParen.substring(1).trim();
      // Extract input types from args if they have type annotations
      const inputTypes = args.map((arg) => {
        if (typeof arg === 'string' && arg.includes(':')) {
          return arg.split(':')[1].trim();
        }
        return 'any';
      });

      // Clean argument names (remove type annotations)
      args = args.map((arg) => {
        if (typeof arg === 'string' && arg.includes(':')) {
          return arg.split(':')[0].trim();
        }
        return arg;
      });

      types = [inputTypes.length === 1 ? inputTypes[0] : inputTypes, returnType];
    }
  } else {
    args = [leftPart];
  }

  const returnValue = parseElement(rightPart);

  if (types) {
    return [args, types, returnValue];
  }
  return [args, returnValue];
}

/**
 * Parse function calls and generics like func(a, b) or Component<{ foo: string }>
 */
function parseFunctionOrGeneric(str: string): any {
  // Check for generics first
  const angleStart = str.indexOf('<');
  const parenStart = str.indexOf('(');

  if (angleStart !== -1 && (parenStart === -1 || angleStart < parenStart)) {
    return parseGeneric(str);
  }

  if (parenStart !== -1) {
    const result = parseFunctionCall(str);
    // If parseFunctionCall detected property access and returned [str], unwrap it
    if (Array.isArray(result) && result.length === 1 && result[0] === str) {
      return str;
    }
    return result;
  }

  return str;
}

/**
 * Parse generic content while preserving nested structures
 */
function parseGenericContent(content: string): any[] {
  const elements: any[] = [];
  let current = '';
  let parenCount = 0;
  let braceCount = 0;
  let bracketCount = 0;
  let angleCount = 0;
  let inString = false;
  let stringChar = '';

  for (let i = 0; i < content.length; i += 1) {
    const char = content[i];

    if (!inString && (char === '"' || char === "'")) {
      inString = true;
      stringChar = char;
      current += char;
    } else if (inString && char === stringChar && content[i - 1] !== '\\') {
      inString = false;
      stringChar = '';
      current += char;
    } else if (!inString) {
      if (char === '(') {
        parenCount += 1;
      } else if (char === ')') {
        parenCount -= 1;
      } else if (char === '{') {
        braceCount += 1;
      } else if (char === '}') {
        braceCount -= 1;
      } else if (char === '[') {
        bracketCount += 1;
      } else if (char === ']') {
        bracketCount -= 1;
      } else if (char === '<') {
        angleCount += 1;
      } else if (char === '>') {
        angleCount -= 1;
      } else if (
        char === ',' &&
        parenCount === 0 &&
        braceCount === 0 &&
        bracketCount === 0 &&
        angleCount === 0
      ) {
        if (current.trim()) {
          elements.push(parseElement(current.trim()));
        }
        current = '';
        continue;
      }
      current += char;
    } else {
      current += char;
    }
  }

  if (current.trim()) {
    elements.push(parseElement(current.trim()));
  }

  return elements;
}

/**
 * Parse generic like Component<{ foo: string }> or Theme<"dark" | "light", Component[]>
 */
function parseGeneric(str: string): any[] {
  const angleStart = str.indexOf('<');
  const name = str.substring(0, angleStart).trim();

  // Find matching closing angle bracket
  let angleCount = 0;
  let angleEnd = -1;

  for (let i = angleStart; i < str.length; i += 1) {
    if (str[i] === '<') {
      angleCount += 1;
    } else if (str[i] === '>') {
      angleCount -= 1;
      if (angleCount === 0) {
        angleEnd = i;
        break;
      }
    }
  }

  if (angleEnd === -1) {
    return [str];
  }

  const genericContent = str.substring(angleStart + 1, angleEnd).trim();
  const afterGeneric = str.substring(angleEnd + 1).trim();

  // Parse generic content - don't split on commas within generics for unions and arrays
  const generics = genericContent ? parseGenericContent(genericContent) : [];

  // Check if there are function arguments after the generic
  if (afterGeneric.startsWith('(') && afterGeneric.endsWith(')')) {
    const argContent = afterGeneric.slice(1, -1).trim();
    const args = argContent ? parseArgumentsRecursive(argContent) : [];
    return [name, generics, args];
  }

  // For standalone generics like Component<Props>, treat as function call with empty args
  // This matches the test expectation for Component<{ foo: string }> -> ['Component', [{ foo: 'string' }], []]
  return [name, generics, []];
}

/**
 * Parse function call like func(a, b)
 */
function parseFunctionCall(str: string): any[] {
  const parenStart = str.indexOf('(');
  const name = str.substring(0, parenStart).trim();

  // Find matching closing parenthesis
  let parenCount = 0;
  let parenEnd = -1;

  for (let i = parenStart; i < str.length; i += 1) {
    if (str[i] === '(') {
      parenCount += 1;
    } else if (str[i] === ')') {
      parenCount -= 1;
      if (parenCount === 0) {
        parenEnd = i;
        break;
      }
    }
  }

  if (parenEnd === -1) {
    return [str];
  }

  // Check if there's meaningful continuation after the closing parenthesis
  const remainingLength = str.length - parenEnd - 1;
  if (remainingLength > 0) {
    // Skip whitespace to find the first meaningful character
    let i = parenEnd + 1;
    while (
      i < str.length &&
      (str[i] === ' ' || str[i] === '\t' || str[i] === '\n' || str[i] === '\r')
    ) {
      i += 1;
    }

    if (i < str.length) {
      const firstChar = str[i];
      if (firstChar === '.' || firstChar === '[' || firstChar === '(' || firstChar === '!') {
        // Property access, bracket notation, chained calls, or non-null assertion
        return [str];
      }
      if (firstChar === '?' && i + 1 < str.length && str[i + 1] === '.') {
        // Optional chaining
        return [str];
      }
    }
  }

  const argContent = str.substring(parenStart + 1, parenEnd).trim();
  if (!argContent) {
    return [name, []];
  }

  const args = parseArgumentsRecursive(argContent);

  // Special case: if there's a single array literal argument, flatten it
  if (args.length === 1 && Array.isArray(args[0])) {
    return [name, args[0]];
  }

  return [name, args];
}

/**
 * Parse TypeScript type assertion like "Component as React.FC<Props>"
 */
function parseTypeAssertion(str: string): any[] {
  const asIndex = str.indexOf(' as ');
  if (asIndex === -1) {
    return [str]; // fallback to string if no 'as' found
  }

  const expression = str.substring(0, asIndex).trim();
  const type = str.substring(asIndex + 4).trim(); // +4 for ' as '

  // Parse the expression part recursively in case it's complex
  const parsedExpression = parseElement(expression);

  return ['as', type, parsedExpression];
}
