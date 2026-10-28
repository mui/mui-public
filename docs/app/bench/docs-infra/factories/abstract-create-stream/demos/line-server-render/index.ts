import { createDemoPerformance } from '@/functions/createDemoPerformance';
import Page from './page';

export const DemoLineServerRender = createDemoPerformance(import.meta.url, Page);
