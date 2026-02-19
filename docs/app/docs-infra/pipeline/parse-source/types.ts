import { createMultipleTypes } from '@/functions/createTypes';
import * as parseSource from '@mui/internal-docs-infra/pipeline/parseSource';

const { types, AdditionalTypes } = createMultipleTypes(import.meta.url, parseSource);

export const TypesParseSource = types;
export const TypesParseSourceAdditional = AdditionalTypes;
