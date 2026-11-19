import { parser } from '@lezer/javascript';

export const tsx = parser.configure({ dialect: 'ts jsx' });
