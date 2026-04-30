import { createTypes } from '@/functions/createTypes';
import { lintJavascriptDemoFocus } from '@mui/internal-docs-infra/pipeline/lintJavascriptDemoFocus';

export const TypesLintJavascriptDemoFocus = createTypes(import.meta.url, lintJavascriptDemoFocus);
