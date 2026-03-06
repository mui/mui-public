import type { MDXComponents } from 'mdx/types';
import Blockquote from './components/Blockquote/Blockquote';
import { Pre } from './components/Pre';
import { PreInline } from './components/PreInline';
import { PagesIndex } from './components/PagesIndex';
import { Table } from './components/Table';
import { TypeRef } from './components/TypeRef';
import { TypePropRef } from './components/TypePropRef';

export const mdxComponents: MDXComponents = {
  blockquote: Blockquote,
  pre: Pre,
  table: Table,
  PagesIndex,
  TypeRef,
  TypePropRef,
};

export const mdxComponentsInline: MDXComponents = {
  ...mdxComponents,
  pre: PreInline,
};

export function useMDXComponents(components: MDXComponents): MDXComponents {
  return {
    ...components,
    ...mdxComponents,
  };
}
