import { describe, it, expect } from 'vitest';
import {
  isExternalType,
  isIntrinsicType,
  isUnionType,
  isIntersectionType,
  isObjectType,
  isArrayType,
  isFunctionType,
  isLiteralType,
  isEnumType,
  isTupleType,
  isTypeParameterType,
} from './typeGuards';

describe('type guard helpers', () => {
  it('should identify external types', () => {
    const externalType = { kind: 'external', typeName: { name: 'External' } };
    expect(isExternalType(externalType)).toBe(true);
    expect(isIntrinsicType(externalType)).toBe(false);
  });

  it('should identify intrinsic types', () => {
    const intrinsicType = { kind: 'intrinsic', intrinsic: 'string' };
    expect(isIntrinsicType(intrinsicType)).toBe(true);
    expect(isExternalType(intrinsicType)).toBe(false);
  });

  it('should identify union types', () => {
    const unionType = { kind: 'union', types: [] };
    expect(isUnionType(unionType)).toBe(true);
    expect(isIntersectionType(unionType)).toBe(false);
  });

  it('should identify intersection types', () => {
    const intersectionType = { kind: 'intersection', types: [] };
    expect(isIntersectionType(intersectionType)).toBe(true);
    expect(isUnionType(intersectionType)).toBe(false);
  });

  it('should identify object types', () => {
    const objectType = { kind: 'object', properties: [] };
    expect(isObjectType(objectType)).toBe(true);
    expect(isArrayType(objectType)).toBe(false);
  });

  it('should identify array types', () => {
    const arrayType = { kind: 'array', elementType: { kind: 'intrinsic', intrinsic: 'string' } };
    expect(isArrayType(arrayType)).toBe(true);
    expect(isObjectType(arrayType)).toBe(false);
  });

  it('should identify function types', () => {
    const functionType = { kind: 'function', callSignatures: [] };
    expect(isFunctionType(functionType)).toBe(true);
    expect(isLiteralType(functionType)).toBe(false);
  });

  it('should identify literal types', () => {
    const literalType = { kind: 'literal', value: 'test' };
    expect(isLiteralType(literalType)).toBe(true);
    expect(isFunctionType(literalType)).toBe(false);
  });

  it('should identify enum types', () => {
    const enumType = { kind: 'enum', members: [] };
    expect(isEnumType(enumType)).toBe(true);
    expect(isTupleType(enumType)).toBe(false);
  });

  it('should identify tuple types', () => {
    const tupleType = { kind: 'tuple', types: [] };
    expect(isTupleType(tupleType)).toBe(true);
    expect(isEnumType(tupleType)).toBe(false);
  });

  it('should identify type parameter types', () => {
    const typeParamType = { kind: 'typeParameter', name: 'T' };
    expect(isTypeParameterType(typeParamType)).toBe(true);
    expect(isIntrinsicType(typeParamType)).toBe(false);
  });
});
