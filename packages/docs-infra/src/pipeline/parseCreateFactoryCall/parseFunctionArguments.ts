import ts from 'typescript';

/**
 * Structured argument types for discriminating between different code constructs:
 * - `[Array]`: Literal array - e.g., `['1', '2', '3']`
 * - `[String, Array]`: Function call - e.g., `['func', ['a', 'b']]`
 * - `[String, Array, Array]`: Function with generics
 * - `[Array, any]`: Simple arrow function
 * - `[Array, [any, any], any]`: Typed arrow function
 * - `['as', string, any]`: TypeScript type assertion
 * - `Record<string, any>`: Object literal
 * - `string`: Plain source text
 */
export type SplitArguments = Array<string | SplitArguments | Record<string, any>>;

/** Extracts a literal array representation. */
export function isArray(value: any): { items: any[] } | false {
  if (Array.isArray(value) && value.length === 1 && Array.isArray(value[0])) {
    return { items: value };
  }
  return false;
}

/** Extracts a function-call representation. */
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

/** Extracts a generic expression representation. */
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

/** Extracts an arrow-function representation. */
export function isArrowFunction(
  value: any,
): { args: any[]; types?: [any, any]; returnValue: any } | false {
  if (Array.isArray(value) && Array.isArray(value[0])) {
    if (value.length === 2) {
      return { args: value[0], returnValue: value[1] };
    }
    if (value.length === 3 && Array.isArray(value[1]) && value[1].length === 2) {
      return { args: value[0], types: [value[1][0], value[1][1]], returnValue: value[2] };
    }
  }
  return false;
}

/** Extracts an object-literal representation. */
export function isObjectLiteral(value: any): { properties: Record<string, any> } | false {
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    return { properties: value };
  }
  return false;
}

/** Extracts a TypeScript type-assertion representation. */
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

/** Converts a TypeScript type node to the existing structured representation. */
function parseTypeNode(node: ts.TypeNode, sourceFile: ts.SourceFile): any {
  if (ts.isTypeLiteralNode(node)) {
    const properties: Record<string, any> = {};
    for (const member of node.members) {
      if (ts.isPropertySignature(member) && member.name) {
        const memberText = member.getText(sourceFile);
        const colonIndex = memberText.indexOf(':');
        const name = (
          colonIndex === -1 ? member.name.getText(sourceFile) : memberText.slice(0, colonIndex)
        ).trim();
        properties[name] = member.type ? parseTypeNode(member.type, sourceFile) : 'any';
      }
    }
    return properties;
  }
  if (ts.isTypeReferenceNode(node)) {
    if (node.typeArguments) {
      return [
        node.typeName.getText(sourceFile),
        node.typeArguments.map((argument) => parseTypeNode(argument, sourceFile)),
        [],
      ];
    }
  }
  return node.getText(sourceFile);
}

/** Converts an object literal while preserving the parser's established output format. */
function parseObjectLiteral(node: ts.ObjectLiteralExpression, sourceFile: ts.SourceFile) {
  const properties: Record<string, any> = {};
  for (const property of node.properties) {
    if (ts.isPropertyAssignment(property)) {
      const name = property.name.getText(sourceFile);
      const value = parseNode(property.initializer, sourceFile);
      properties[name] = ts.isArrayLiteralExpression(property.initializer) ? [value] : value;
    } else if (ts.isShorthandPropertyAssignment(property)) {
      properties[property.name.text] = property.name.text;
    } else {
      const text = property.getText(sourceFile);
      properties[text] = text;
    }
  }
  return properties;
}

/** Converts an expression node to the existing structured representation. */
function parseNode(node: ts.Expression, sourceFile: ts.SourceFile): any {
  if (ts.isParenthesizedExpression(node)) {
    return parseNode(node.expression, sourceFile);
  }
  if (ts.isObjectLiteralExpression(node)) {
    return parseObjectLiteral(node, sourceFile);
  }
  if (ts.isArrayLiteralExpression(node)) {
    return node.elements.map((element) =>
      ts.isSpreadElement(element) ? element.getText(sourceFile) : parseNode(element, sourceFile),
    );
  }
  if (ts.isAsExpression(node)) {
    return ['as', node.type.getText(sourceFile), parseNode(node.expression, sourceFile)];
  }
  if (ts.isArrowFunction(node)) {
    const hasReturnType = Boolean(node.type);
    const parameters = node.parameters.map((parameter) =>
      hasReturnType ? parameter.name.getText(sourceFile) : parameter.getText(sourceFile),
    );
    const returnValue = ts.isBlock(node.body)
      ? node.body.getText(sourceFile)
      : parseNode(node.body, sourceFile);
    if (node.type) {
      const inputTypes = node.parameters.map((parameter) =>
        parameter.type ? parameter.type.getText(sourceFile) : 'any',
      );
      return [
        parameters,
        [inputTypes.length === 1 ? inputTypes[0] : inputTypes, node.type.getText(sourceFile)],
        returnValue,
      ];
    }
    return [parameters, returnValue];
  }
  if (ts.isCallExpression(node)) {
    if (node.expression.getText(sourceFile).includes('(') || node.questionDotToken) {
      return node.getText(sourceFile);
    }
    const name = node.expression.getText(sourceFile);
    const argumentsValue = node.arguments.map((argument) => parseNode(argument, sourceFile));
    if (node.typeArguments) {
      return [
        name,
        node.typeArguments.map((argument) => parseTypeNode(argument, sourceFile)),
        argumentsValue,
      ];
    }
    if (node.arguments.length === 1 && ts.isArrayLiteralExpression(node.arguments[0])) {
      return [name, argumentsValue[0]];
    }
    return [name, argumentsValue];
  }
  if (ts.isExpressionWithTypeArguments(node)) {
    return [
      node.expression.getText(sourceFile),
      node.typeArguments?.map((argument) => parseTypeNode(argument, sourceFile)) ?? [],
      [],
    ];
  }
  return node.getText(sourceFile);
}

/**
 * Parses factory arguments through a synthetic TypeScript call expression and
 * converts its argument nodes to the established serializable representation.
 */
export function parseFunctionArguments(source: string): SplitArguments {
  if (!source.trim()) {
    return [];
  }
  const prefix = '__parseFactoryArguments(';
  const sourceFile = ts.createSourceFile(
    'factory-arguments.ts',
    `${prefix}${source})`,
    ts.ScriptTarget.Latest,
    false,
    ts.ScriptKind.TS,
  );
  const statement = sourceFile.statements[0];
  if (
    !statement ||
    !ts.isExpressionStatement(statement) ||
    !ts.isCallExpression(statement.expression)
  ) {
    return [source.trim()];
  }
  return statement.expression.arguments.map((argument) => parseNode(argument, sourceFile));
}
