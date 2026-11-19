import { configureNesting, parser } from '@lezer/html';
import { css } from './css';
import { js } from './js';

export const html = parser.configure({
  wrap: configureNesting([
    { tag: 'script', parser: js },
    { tag: 'style', parser: css },
  ]),
});
