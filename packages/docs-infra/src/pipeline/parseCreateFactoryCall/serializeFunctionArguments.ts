/**
 * Utility function for serializing structured function arguments back to string format
 * This is the inverse of parseFunctionArguments - it takes structured data and creates
 * valid JavaScript/TypeScript function call arguments.
 */

import type { SplitArguments } from './parseFunctionArguments';
import {
  isArray,
  isFunction,
  isGeneric,
  isArrowFunction,
  isObjectLiteral,
  isTypeAssertion,
} from './parseFunctionArguments';

/**
 * Serialize structured arguments back to a string representation
 * Uses JSON.stringify for object values for performance and reliability
 */
export function serializeFunctionArguments(args: SplitArguments): string {
  return args.map((arg) => serializeArgument(arg)).join(', ');
}

/**
 * Serialize a single argument based on its type
 */
function serializeArgument(arg: any): string {
  if (typeof arg === 'string') {
    return arg;
  }

  if (typeof arg === 'number' || typeof arg === 'boolean' || arg === null) {
    return String(arg);
  }

  // Check structured types using type guards
  const arrayCheck = isArray(arg);
  if (arrayCheck) {
    return `[${arrayCheck.items.map((item) => serializeArgument(item)).join(', ')}]`;
  }

  const functionCheck = isFunction(arg);
  if (functionCheck) {
    const args = functionCheck.arguments.map((p) => serializeArgument(p)).join(', ');
    return `${functionCheck.name}(${args})`;
  }

  const genericCheck = isGeneric(arg);
  if (genericCheck) {
    const generics = genericCheck.generics.map((g) => serializeArgument(g)).join(', ');
    if (genericCheck.arguments === null) {
      // Type generic like Theme<"dark" | "light">
      return `${genericCheck.name}<${generics}>`;
    }
    // Function generic like Component<Props>(args) - only add () if there are actual arguments
    if (genericCheck.arguments.length > 0) {
      const args = genericCheck.arguments.map((p) => serializeArgument(p)).join(', ');
      return `${genericCheck.name}<${generics}>(${args})`;
    }
    // Generic without function call - like Component<Props>
    return `${genericCheck.name}<${generics}>`;
  }

  const arrowCheck = isArrowFunction(arg);
  if (arrowCheck) {
    const args = arrowCheck.args.map((p) => serializeArgument(p)).join(', ');
    const argStr = arrowCheck.args.length === 1 ? args : `(${args})`;

    if (arrowCheck.types) {
      // Typed arrow function
      const [inputTypes, outputTypes] = arrowCheck.types;
      const inputTypeStr = Array.isArray(inputTypes) ? inputTypes.join(', ') : inputTypes;
      return `(${args}: ${inputTypeStr}): ${outputTypes} => ${serializeArgument(arrowCheck.returnValue)}`;
    }
    // Simple arrow function
    return `${argStr} => ${serializeArgument(arrowCheck.returnValue)}`;
  }

  const typeAssertionCheck = isTypeAssertion(arg);
  if (typeAssertionCheck) {
    return `${serializeArgument(typeAssertionCheck.expression)} as ${typeAssertionCheck.type}`;
  }

  const objectCheck = isObjectLiteral(arg);
  if (objectCheck) {
    return serializeObject(objectCheck.properties);
  }

  // Array but not a structured type - serialize as array literal
  if (Array.isArray(arg)) {
    // Check if this is a double-wrapped array literal from parseArrayLiteral
    // parseArrayLiteral calls parseArgumentsRecursive which returns an array,
    // so we get [[item1, item2]] instead of [item1, item2]
    const doubleWrappedCheck = isArray(arg);
    if (doubleWrappedCheck) {
      // This is a double-wrapped array literal - unwrap it
      return `[${arg[0].map((item: any) => serializeArgument(item)).join(', ')}]`;
    }

    // Regular array
    return `[${arg.map((item: any) => serializeArgument(item)).join(', ')}]`;
  }

  // Object but not a structured type - serialize as object literal
  if (typeof arg === 'object' && arg !== null) {
    return serializeObject(arg);
  }

  // Fallback to string representation
  return String(arg);
}

/**
 * Serialize an object to JavaScript object literal syntax
 */
function serializeObject(obj: Record<string, any>): string {
  if (Object.keys(obj).length === 0) {
    return '{}';
  }

  const entries = Object.entries(obj).map(([key, value]) => {
    const serializedValue = serializeObjectValue(value);

    // Handle shorthand properties (key === value)
    if (typeof value === 'string' && key === value) {
      return key;
    }

    return `${key}: ${serializedValue}`;
  });

  return `{ ${entries.join(', ')} }`;
} /**
 * Serialize an object value, using JSON.stringify when appropriate
 */
function serializeObjectValue(value: any): string {
  // Special case: array literals in objects are double-wrapped by the parser
  // Check if this is a double-wrapped array literal: [[item1, item2, item3]]
  // This MUST come before the structured type check to prevent it being treated as a structured array
  if (isArray(value)) {
    // This is a double-wrapped array literal - unwrap it
    return `[${value[0].map((item: any) => serializeObjectValue(item)).join(', ')}]`;
  }

  // For structured types, recursively serialize first
  if (typeof value === 'object' && value !== null && isStructuredType(value)) {
    return serializeArgument(value);
  }

  // For primitive values, just convert to string
  if (typeof value === 'number' || typeof value === 'boolean' || value === null) {
    return String(value);
  }

  // For strings, preserve original quotes from the parser
  if (typeof value === 'string') {
    // The parser preserves quotes for string literals and returns identifiers without quotes
    // So we should return exactly what the parser gave us
    return value;
  }

  // For plain objects and arrays, serialize keys/values individually
  if (typeof value === 'object' && value !== null && !isStructuredType(value)) {
    if (Array.isArray(value)) {
      // Check if this is a double-wrapped array literal
      if (isArray(value)) {
        // This is a double-wrapped array literal - unwrap it
        return `[${value[0].map((item: any) => serializeObjectValue(item)).join(', ')}]`;
      }
      // Regular array
      return `[${value.map((item: any) => serializeObjectValue(item)).join(', ')}]`;
    }
    const pairs = Object.entries(value).map(([key, val]) => `${key}: ${serializeObjectValue(val)}`);
    return `{ ${pairs.join(', ')} }`;
  }

  // Fallback
  return serializeArgument(value);
}

/**
 * Check if a value is one of our structured types that needs special handling
 */
function isStructuredType(value: any): boolean {
  return !!(
    isArray(value) ||
    isFunction(value) ||
    isGeneric(value) ||
    isArrowFunction(value) ||
    isTypeAssertion(value)
  );
}
