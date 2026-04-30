import { createTypes } from '../createTypes';
import { formatGreeting } from './myFunction';

export const TypesFunction = createTypes(import.meta.url, formatGreeting);
