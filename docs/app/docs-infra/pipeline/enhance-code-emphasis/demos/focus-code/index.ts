import { createDemo } from '@/functions/createDemo';
import { FocusCode } from './FocusCode';

export const DemoFocusCode = createDemo(import.meta.url, FocusCode, {
  name: '@focus Directive',
  slug: 'focus-directive',
});
