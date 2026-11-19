import { GFM, parseCode, parser } from '@lezer/markdown';
import { html } from './html';

export const md = parser.configure([GFM, parseCode({ htmlParser: html })]);
