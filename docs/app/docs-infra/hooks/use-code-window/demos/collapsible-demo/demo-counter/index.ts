import { Counter } from './Counter';
import { createDemo } from '../createDemo';

export const DemoCounter = createDemo(import.meta.url, Counter);
