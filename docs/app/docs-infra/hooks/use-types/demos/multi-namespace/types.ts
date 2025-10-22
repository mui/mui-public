import { createMultipleTypes } from '../createTypes';
import * as Components from './components';

const types = createMultipleTypes(import.meta.url, Components);

export const TypesButton = types.Button;
export const TypesCheckbox = types.Checkbox;
