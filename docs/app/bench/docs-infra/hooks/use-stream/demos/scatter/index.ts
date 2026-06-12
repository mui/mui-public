import { createDemoPerformance } from '@/functions/createDemoPerformance';
import Page from './page';

export const DemoStreamingScatterPerformance = createDemoPerformance(import.meta.url, Page);
