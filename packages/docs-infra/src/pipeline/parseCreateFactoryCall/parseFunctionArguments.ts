/**
 * Utility function for parsing function arguments and handling nested structures
 * in JavaScript/TypeScript code with structured representations.
 *
 * Parsing is delegated to the oxc parser; the resulting AST is translated into
 * the structured tuple representation consumed by `serializeFunctionArguments`
 * and `parseCreateFactoryCall`.
 */
import { parseSync } from 'oxc-parser';
import type {
  Argument,
  ArrowFunctionExpression,
  CallExpression,
  Comment,
  Expression,
  ObjectExpression,
  TSType,
} from 'oxc-parser';

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

/** Parsed source plus comment spans, used to slice comment-free text from node ranges. */
interface ParseContext {
  source: string;
  comments: Comment[];
}

const WRAPPER_PREFIX = '__parseArguments__(';

/**
 * Main API: Parse arguments and return structured representation
 * This is the primary parsing function optimized for recursive data structures
 */
export function parseFunctionArguments(str: string): SplitArguments {
  if (!str.trim()) {
    return [];
  }

  // Wrap the argument list in a call so oxc parses it as a single expression;
  // the trailing newline keeps a final line comment from swallowing the paren.
  const source = `${WRAPPER_PREFIX}${str}\n)`;
  const parsed = parseSync('arguments.ts', source);
  const statement = parsed.program.body[0];

  if (
    parsed.program.body.length !== 1 ||
    statement?.type !== 'ExpressionStatement' ||
    statement.expression.type !== 'CallExpression'
  ) {
    return [str.trim()];
  }

  const context: ParseContext = { source, comments: parsed.comments };
  return statement.expression.arguments.map((argument) => argumentToValue(argument, context));
}

/**
 * Slice source text for a node range, removing any comments inside the range.
 */
function sliceWithoutComments(context: ParseContext, start: number, end: number): string {
  let text = '';
  let cursor = start;

  for (const comment of context.comments) {
    if (comment.end <= cursor || comment.start >= end) {
      continue;
    }
    text += context.source.slice(cursor, Math.max(comment.start, cursor));
    cursor = Math.min(comment.end, end);
  }

  text += context.source.slice(cursor, end);
  return text.trim();
}

/**
 * Convert a call argument (expression or spread) to its structured value.
 */
function argumentToValue(argument: Argument, context: ParseContext): any {
  if (argument.type === 'SpreadElement') {
    return sliceWithoutComments(context, argument.start, argument.end);
  }
  return expressionToValue(argument, context);
}

/**
 * Return the dotted callee name (e.g. `namespace.createComponent`) if the callee
 * is a plain identifier chain, or undefined for computed/chained/call callees.
 */
function simpleCalleeName(callee: CallExpression['callee'], context: ParseContext) {
  let current = callee;
  while (current.type === 'MemberExpression' && !current.computed && !current.optional) {
    current = current.object;
  }
  if (current.type !== 'Identifier') {
    return undefined;
  }
  return sliceWithoutComments(context, callee.start, callee.end);
}

/**
 * Convert an expression AST node to the structured representation.
 */
function expressionToValue(node: Expression, context: ParseContext): any {
  switch (node.type) {
    case 'ObjectExpression':
      return objectToValue(node, context);
    case 'ArrayExpression':
      return node.elements.map((element) =>
        element === null ? '' : argumentToValue(element, context),
      );
    case 'CallExpression': {
      const name = node.optional ? undefined : simpleCalleeName(node.callee, context);
      if (name === undefined) {
        break;
      }
      const args = node.arguments.map((argument) => argumentToValue(argument, context));
      if (node.typeArguments) {
        const generics = node.typeArguments.params.map((param) => typeToValue(param, context));
        return [name, generics, args];
      }
      // A single array-valued argument is flattened into the arguments slot.
      if (args.length === 1 && Array.isArray(args[0])) {
        return [name, args[0]];
      }
      return [name, args];
    }
    case 'TSInstantiationExpression': {
      const name = sliceWithoutComments(context, node.expression.start, node.expression.end);
      const generics = node.typeArguments.params.map((param) => typeToValue(param, context));
      return [name, generics, []];
    }
    case 'TSAsExpression': {
      const type = sliceWithoutComments(
        context,
        node.typeAnnotation.start,
        node.typeAnnotation.end,
      );
      return ['as', type, expressionToValue(node.expression, context)];
    }
    case 'ArrowFunctionExpression':
      return arrowFunctionToValue(node, context);
    default:
      break;
  }

  // Everything else (identifiers, literals, member/chain expressions, templates)
  // is represented by its source text.
  return sliceWithoutComments(context, node.start, node.end);
}

/**
 * Convert an object literal to a plain record of structured values.
 */
function objectToValue(node: ObjectExpression, context: ParseContext): Record<string, any> {
  const result: Record<string, any> = {};

  for (const property of node.properties) {
    if (property.type !== 'Property') {
      const text = sliceWithoutComments(context, property.start, property.end);
      result[text] = text;
      continue;
    }

    const key =
      property.key.type === 'Identifier' && !property.computed
        ? property.key.name
        : sliceWithoutComments(context, property.key.start, property.key.end);

    if (property.shorthand) {
      result[key] = key;
      continue;
    }

    const value = expressionToValue(property.value as Expression, context);
    // Array literal values are double-wrapped to distinguish them from
    // function-call and generic tuples.
    result[key] = property.value.type === 'ArrayExpression' ? [value] : value;
  }

  return result;
}

/**
 * Convert an arrow function to `[args, returnValue]`, or
 * `[args, [inputTypes, outputType], returnValue]` when a return type is annotated.
 */
function arrowFunctionToValue(node: ArrowFunctionExpression, context: ParseContext): any[] {
  const returnValue =
    node.body.type === 'BlockStatement'
      ? sliceWithoutComments(context, node.body.start, node.body.end)
      : expressionToValue(node.body as Expression, context);

  if (!node.returnType) {
    // Untyped form keeps parameter text verbatim (including any type annotations).
    const args = node.params.map((param) => sliceWithoutComments(context, param.start, param.end));
    return [args, returnValue];
  }

  const args = node.params.map((param) =>
    param.type === 'Identifier'
      ? param.name
      : sliceWithoutComments(context, param.start, param.end),
  );
  const inputTypes = node.params.map((param) =>
    param.type === 'Identifier' && param.typeAnnotation
      ? sliceWithoutComments(
          context,
          param.typeAnnotation.typeAnnotation.start,
          param.typeAnnotation.typeAnnotation.end,
        )
      : 'any',
  );
  const outputType = sliceWithoutComments(
    context,
    node.returnType.typeAnnotation.start,
    node.returnType.typeAnnotation.end,
  );

  return [args, [inputTypes.length === 1 ? inputTypes[0] : inputTypes, outputType], returnValue];
}

/**
 * Convert a type argument to the structured representation: type literals become
 * records, parameterized type references become generic tuples, and any other
 * type is represented by its source text.
 */
function typeToValue(node: TSType, context: ParseContext): any {
  if (node.type === 'TSTypeLiteral') {
    const result: Record<string, any> = {};
    for (const member of node.members) {
      if (member.type === 'TSPropertySignature' && member.key.type === 'Identifier') {
        const key = member.optional ? `${member.key.name}?` : member.key.name;
        result[key] = member.typeAnnotation
          ? typeToValue(member.typeAnnotation.typeAnnotation, context)
          : key;
      } else {
        const text = sliceWithoutComments(context, member.start, member.end);
        result[text] = text;
      }
    }
    return result;
  }

  if (node.type === 'TSTypeReference' && node.typeArguments) {
    const name = sliceWithoutComments(context, node.typeName.start, node.typeName.end);
    return [name, node.typeArguments.params.map((param) => typeToValue(param, context)), []];
  }

  return sliceWithoutComments(context, node.start, node.end);
}
