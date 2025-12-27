import { createTypes } from '../createTypes';
import { useHook } from './useHook';

export const TypesHook = createTypes(import.meta.url, useHook);
