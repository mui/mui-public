import type { MDXComponents } from 'mdx/types';
import Blockquote from './components/Blockquote/Blockquote';
import { Pre } from './components/Pre';
import { PagesIndex } from './components/PagesIndex';
import { Table } from './components/Table';
import { TypeRef } from './components/TypeRef';

export const mdxComponents: MDXComponents = {
  blockquote: Blockquote,
  pre: Pre,
  table: Table,
  PagesIndex,
  TypeRef,
};

export const mdxComponentsInline: MDXComponents = {
  ...mdxComponents,
  pre: (props) => <pre {...props} />,
};

export function useMDXComponents(components: MDXComponents): MDXComponents {
  return {
    ...components,
    ...mdxComponents,
  };
}
