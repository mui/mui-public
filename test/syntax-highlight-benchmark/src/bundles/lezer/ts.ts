import { parser } from '@lezer/javascript';

export const ts = parser.configure({ dialect: 'ts' });
