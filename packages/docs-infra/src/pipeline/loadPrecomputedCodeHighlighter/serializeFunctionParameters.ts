/**
 * Utility function for serializing structured function parameters back to string format
 * This is the inverse of parseFunctionParameters - it takes structured data and creates
 * valid JavaScript/TypeScript function call parameters.
 */

import type { SplitParameters } from './parseFunctionParameters';
import {
  isArray,
  isFunction,
  isGeneric,
  isArrowFunction,
  isObjectLiteral,
  isTypeAssertion,
} from './parseFunctionParameters';

/**
 * Serialize structured parameters back to a string representation
 * Uses JSON.stringify for object values for performance and reliability
 */
export function serializeFunctionParameters(parameters: SplitParameters): string {
  return parameters.map((param) => serializeParameter(param)).join(', ');
}

/**
 * Serialize a single parameter based on its type
 */
function serializeParameter(param: any): string {
  if (typeof param === 'string') {
    return param;
  }

  if (typeof param === 'number' || typeof param === 'boolean' || param === null) {
    return String(param);
  }

  // Check structured types using type guards
  const arrayCheck = isArray(param);
  if (arrayCheck) {
    return `[${arrayCheck.items.map((item) => serializeParameter(item)).join(', ')}]`;
  }

  const functionCheck = isFunction(param);
  if (functionCheck) {
    const params = functionCheck.parameters.map((p) => serializeParameter(p)).join(', ');
    return `${functionCheck.name}(${params})`;
  }

  const genericCheck = isGeneric(param);
  if (genericCheck) {
    const generics = genericCheck.generics.map((g) => serializeParameter(g)).join(', ');
    if (genericCheck.parameters === null) {
      // Type generic like Theme<"dark" | "light">
      return `${genericCheck.name}<${generics}>`;
    }
    // Function generic like Component<Props>(args) - only add () if there are actual parameters
    if (genericCheck.parameters.length > 0) {
      const params = genericCheck.parameters.map((p) => serializeParameter(p)).join(', ');
      return `${genericCheck.name}<${generics}>(${params})`;
    }
    // Generic without function call - like Component<Props>
    return `${genericCheck.name}<${generics}>`;
  }

  const arrowCheck = isArrowFunction(param);
  if (arrowCheck) {
    const params = arrowCheck.params.map((p) => serializeParameter(p)).join(', ');
    const paramStr = arrowCheck.params.length === 1 ? params : `(${params})`;

    if (arrowCheck.types) {
      // Typed arrow function
      const [inputTypes, outputTypes] = arrowCheck.types;
      const inputTypeStr = Array.isArray(inputTypes) ? inputTypes.join(', ') : inputTypes;
      return `(${params}: ${inputTypeStr}): ${outputTypes} => ${serializeParameter(arrowCheck.returnValue)}`;
    }
    // Simple arrow function
    return `${paramStr} => ${serializeParameter(arrowCheck.returnValue)}`;
  }

  const typeAssertionCheck = isTypeAssertion(param);
  if (typeAssertionCheck) {
    return `${serializeParameter(typeAssertionCheck.expression)} as ${typeAssertionCheck.type}`;
  }

  const objectCheck = isObjectLiteral(param);
  if (objectCheck) {
    return serializeObject(objectCheck.properties);
  }

  // Array but not a structured type - serialize as array literal
  if (Array.isArray(param)) {
    // Check if this is a double-wrapped array literal from parseArrayLiteral
    // parseArrayLiteral calls parseParametersRecursive which returns an array,
    // so we get [[item1, item2]] instead of [item1, item2]
    const doubleWrappedCheck = isArray(param);
    if (doubleWrappedCheck) {
      // This is a double-wrapped array literal - unwrap it
      return `[${param[0].map((item: any) => serializeParameter(item)).join(', ')}]`;
    }

    // Regular array
    return `[${param.map((item: any) => serializeParameter(item)).join(', ')}]`;
  }

  // Object but not a structured type - serialize as object literal
  if (typeof param === 'object' && param !== null) {
    return serializeObject(param);
  }

  // Fallback to string representation
  return String(param);
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
    return serializeParameter(value);
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
  return serializeParameter(value);
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
