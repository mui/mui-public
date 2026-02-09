import type { MDXComponents } from 'mdx/types';
import Blockquote from './components/Blockquote/Blockquote';
import { Pre } from './components/Pre';
import { PagesIndex } from './components/PagesIndex';
import { Table } from './components/Table';

export function useMDXComponents(components: MDXComponents): MDXComponents {
  return {
    ...components,
    blockquote: Blockquote,
    pre: Pre,
    table: Table,
    PagesIndex,
  };
}
