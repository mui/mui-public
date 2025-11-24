import type { MDXComponents } from 'mdx/types';
import Blockquote from './components/Blockquote/Blockquote';
import { Pre } from './components/Pre';

export function useMDXComponents(components: MDXComponents): MDXComponents {
  return {
    ...components,
    blockquote: Blockquote,
    pre: Pre,
  };
}
