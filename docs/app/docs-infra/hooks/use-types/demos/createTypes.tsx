import {
  createTypesFactory,
  createMultipleTypesFactory,
} from '@mui/internal-docs-infra/abstractCreateTypes';
import { TypesTable } from './TypesTable';

export const createTypes = createTypesFactory({ TypesContent: TypesTable });
export const createMultipleTypes = createMultipleTypesFactory({ TypesContent: TypesTable });
