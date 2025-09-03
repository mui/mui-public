import { CheckboxRed as CssModules } from './css-modules/CheckboxRed';
import { CheckboxRed as Tailwind } from './tailwind/CheckboxRed';
import { createDemoWithVariants } from '../createDemo';

export const DemoCheckboxRed = createDemoWithVariants(import.meta.url, { CssModules, Tailwind });
