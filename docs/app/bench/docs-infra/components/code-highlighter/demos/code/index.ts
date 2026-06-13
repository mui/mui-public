import { createDemoPerformance } from '@/functions/createDemoPerformance';
import Page from './demo/page';

export const DemoCodeHighlighterPerformance = createDemoPerformance(import.meta.url, Page);
