import { createDemoPerformance } from '@/functions/createDemoPerformance';
import Page from './page';

export const DemoLineServerClient = createDemoPerformance(import.meta.url, Page);
