import type { MDXComponents } from 'mdx/types';
import Blockquote from './components/Blockquote/Blockquote';
import { Pre } from './components/Pre';
import { PagesIndex } from './components/PagesIndex';
import { Table } from './components/Table';
import { TypeRef } from './components/TypeRef';
import { TypePropRef } from './components/TypePropRef';
import { Heading1, Heading2, Heading3, Heading4, Heading5, Heading6 } from './components/Heading';

export const mdxComponents: MDXComponents = {
  blockquote: Blockquote,
  pre: Pre,
  table: Table,
  PagesIndex,
  TypeRef,
  TypePropRef,
  h1: Heading1,
  h2: Heading2,
  h3: Heading3,
  h4: Heading4,
  h5: Heading5,
  h6: Heading6,
};

export function useMDXComponents(components: MDXComponents): MDXComponents {
  return {
    ...components,
    ...mdxComponents,
  };
}
