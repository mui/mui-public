import { createDemoPerformance } from '@/functions/createDemoPerformance';
import Page from './page';

export const DemoScatter100k = createDemoPerformance(import.meta.url, Page);
