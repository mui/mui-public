import { createDemo } from '@/functions/createDemo';
import { MultiNamespaceDemo } from './MultiNamespaceDemo';

export const DemoUseTypesMultiNamespace = createDemo(import.meta.url, MultiNamespaceDemo);
