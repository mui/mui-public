import { createDemo } from '@/functions/createDemo';
import { LiveMetricsMonitor } from './LiveMetricsMonitor';

export const DemoChunkLiveMetrics = createDemo(import.meta.url, LiveMetricsMonitor);
