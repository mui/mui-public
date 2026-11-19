import { GFM, parseCode, parser } from '@lezer/markdown';
import { tsx } from './tsx';

export const mdx = parser.configure([GFM, parseCode({ htmlParser: tsx })]);
