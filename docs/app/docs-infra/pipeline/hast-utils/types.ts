import { createMultipleTypes } from '@/functions/createTypes';
import * as hastUtils from '@mui/internal-docs-infra/pipeline/hastUtils';

const { types } = createMultipleTypes(import.meta.url, hastUtils);

export const TypesHastOrJsonToJsx = types.hastOrJsonToJsx;

export const TypesHastToJsx = types.hastToJsx;

export const TypesStringOrHastToJsx = types.stringOrHastToJsx;

export const TypesStringOrHastToString = types.stringOrHastToString;
