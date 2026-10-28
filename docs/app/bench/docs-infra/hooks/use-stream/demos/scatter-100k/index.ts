import { createDemoPerformance } from '@/functions/createDemoPerformance';
import Page from './page';

export const DemoStreamingScatter100kPerformance = createDemoPerformance(import.meta.url, Page);
