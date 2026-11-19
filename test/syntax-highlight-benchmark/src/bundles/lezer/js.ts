import { parser } from '@lezer/javascript';

export const js = parser.configure({ dialect: 'jsx' });
