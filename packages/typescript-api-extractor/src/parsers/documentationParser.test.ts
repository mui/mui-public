import { expect, it } from 'vitest';
import { parseFromProgram } from '../index';
import type { FunctionNode, ObjectNode } from '../models';
import { createInMemoryProgram } from '../../test/support/inMemoryProgram';

const filePath = '/virtual/documentation-tags.ts';

function parse(source: string) {
  return parseFromProgram(filePath, createInMemoryProgram(filePath, source)).exports;
}

it('keeps @see tag values as written', () => {
  const [value] = parse(`
/**
 * @see https://example.com/docs
 * @see https://example.com/docs for details
 * @see {@link https://example.com/docs|Docs}
 * @see {@link Other} and more
 * @see Other#member
 * @see plain text
 * @see
 *   https://example.com/next-line
 */
export const value = 1;
export const Other = { member: 1 };
`);

  expect(value.documentation?.tags).toEqual([
    { name: 'see', value: 'https://example.com/docs' },
    { name: 'see', value: 'https://example.com/docs for details' },
    { name: 'see', value: '{@link https://example.com/docs|Docs}' },
    { name: 'see', value: '{@link Other} and more' },
    { name: 'see', value: 'Other#member' },
    { name: 'see', value: 'plain text' },
    { name: 'see', value: 'https://example.com/next-line' },
  ]);
});

it('keeps inline links in tag values', () => {
  const [value] = parse(`
/**
 * @deprecated Use {@link https://example.com/new} instead.
 */
export const value = 1;
`);

  expect(value.documentation?.tags).toEqual([
    { name: 'deprecated', value: 'Use {@link https://example.com/new} instead.' },
  ]);
});

it('keeps @see tag values on properties', () => {
  const [props] = parse(`
export interface Props {
  /**
   * The value.
   * @see https://example.com/value
   */
  value?: string;
}
`);

  expect((props.type as ObjectNode).properties[0].documentation?.tags).toEqual([
    { name: 'see', value: 'https://example.com/value' },
  ]);
});

it('keeps links and @see tag values in parameter documentation', () => {
  const [fn] = parse(`
export function fn(
  /**
   * The input, see {@link https://example.com/input}.
   * @see https://example.com/param
   * @see {@link https://example.com/docs|Docs}
   * @see Other#member
   */
  input: string,
) {}
`);

  const [parameter] = (fn.type as FunctionNode).callSignatures[0].parameters;
  expect(parameter.documentation).toMatchObject({
    description: 'The input, see {@link https://example.com/input}.',
    tags: [
      { name: 'see', value: 'https://example.com/param' },
      { name: 'see', value: '{@link https://example.com/docs|Docs}' },
      { name: 'see', value: 'Other#member' },
    ],
  });
});
