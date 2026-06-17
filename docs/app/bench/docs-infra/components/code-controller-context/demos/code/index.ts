import { createDemoPerformance } from '@/functions/createDemoPerformance';
import Page from './demo/page';

export const DemoCodeControllerContextPerformance = createDemoPerformance(import.meta.url, Page);
