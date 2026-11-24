import { createDemo } from '@/functions/createDemo';
import { SyntaxThemePreview } from './SyntaxThemePreview';

export const DemoSyntaxThemeLightDark = createDemo(import.meta.url, SyntaxThemePreview, {
  name: 'Light and Dark',
  slug: 'light-and-dark',
});
