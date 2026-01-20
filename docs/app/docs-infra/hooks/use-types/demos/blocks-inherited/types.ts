import { createMultipleTypes } from '../createTypes';
import { AlertDialog } from './AlertDialog';

const { types } = createMultipleTypes(import.meta.url, AlertDialog);

export const TypesAlertDialogTrigger = types.Trigger;
export const TypesAlertDialogClose = types.Close;
