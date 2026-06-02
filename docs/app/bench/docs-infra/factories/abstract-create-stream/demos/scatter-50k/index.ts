import { createDemoPerformance } from '@/functions/createDemoPerformance';
import Page from './page';

export const DemoScatter50k = createDemoPerformance(import.meta.url, Page);
