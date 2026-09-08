import { createMultipleTypes } from '@/functions/createTypes';
import * as generateDemoExternalsModule from '@mui/internal-docs-infra/pipeline/generateDemoExternalsModule';

const { types, AdditionalTypes } = createMultipleTypes(
  import.meta.url,
  generateDemoExternalsModule,
);

export const TypesGenerateDemoExternalsModule = types;
export const TypesGenerateDemoExternalsModuleAdditional = AdditionalTypes;
