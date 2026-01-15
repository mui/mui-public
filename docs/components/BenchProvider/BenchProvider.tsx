'use client';

import * as React from 'react';
import { onCLS, onFCP, onLCP, onINP } from 'web-vitals/attribution';
import type { Metric } from 'web-vitals/attribution';

// Helper function for severity assessment
const getLongTaskSeverity = (duration: number): 'blocking' | 'concerning' | 'minor' => {
  if (duration > 100) {
    return 'blocking';
  }
  if (duration > 50) {
    return 'concerning';
  }
  return 'minor';
};
const getRating = (
  value: number,
  thresholds: { good: number; poor: number },
): 'good' | 'needs-improvement' | 'poor' => {
  if (value <= thresholds.good) {
    return 'good';
  }
  if (value <= thresholds.poor) {
    return 'needs-improvement';
  }
  return 'poor';
};

// Custom metric type for TTI and long tasks
interface CustomMetric {
  name: string;
  value: number;
  rating?: 'good' | 'needs-improvement' | 'poor';
  navigationType?: string;
  entries?: any[];
  metadata?: {
    startTime?: number;
    endTime?: number;
    attribution?: any[];
    source?: string;
    timeFromPageLoad?: number;
    severity?: 'blocking' | 'concerning' | 'minor';
  };
}

const report = (metric: Metric | CustomMetric) => {
  if (!window.parent) {
    // eslint-disable-next-line no-console
    console.log(metric);
    return;
  }

  // Serialize entries to avoid cloning issues with PerformanceEntry objects
  const serializableEntries =
    'entries' in metric && metric.entries
      ? metric.entries.map((entry) => ({
          name: entry.name,
          entryType: entry.entryType,
          startTime: entry.startTime,
          duration: entry.duration,
          // Add other relevant properties that are serializable
          ...(entry.size !== undefined && { size: entry.size }),
          ...(entry.renderTime !== undefined && { renderTime: entry.renderTime }),
          ...(entry.loadTime !== undefined && { loadTime: entry.loadTime }),
        }))
      : undefined;

  window.parent.postMessage(
    {
      source: 'docs-infra:bench',
      type: 'web-vitals',
      metric: {
        name: metric.name,
        navigationType: metric.navigationType,
        rating: metric.rating,
        value: metric.value,
        ...(serializableEntries && { entries: serializableEntries }),
        ...('metadata' in metric && metric.metadata && { metadata: metric.metadata }),
      },
    },
    '*',
  );
};

// Helper functions for TTI calculation
const findLastLongTaskBefore = (
  time: number,
  longTasks: PerformanceEntry[],
): PerformanceEntry | null => {
  let lastTask = null;
  for (const task of longTasks) {
    if (task.startTime < time) {
      lastTask = task;
    } else {
      break;
    }
  }
  return lastTask;
};

const isQuietWindow = (
  startTime: number,
  endTime: number,
  longTasks: PerformanceEntry[],
  networkRequests: PerformanceEntry[],
): boolean => {
  // Early exit: Check for long tasks in this window using binary search approach
  // Since longTasks are already sorted, we can optimize this check
  const firstTaskInWindow = longTasks.find((task) => task.startTime >= startTime);
  if (firstTaskInWindow && firstTaskInWindow.startTime < endTime) {
    return false;
  }

  // Fast path: if no network requests, it's quiet
  if (networkRequests.length === 0) {
    return true;
  }

  // Optimized network request check - only process relevant requests
  let maxConcurrentRequests = 0;
  let currentRequests = 0;

  // Pre-filter and create events only for relevant requests
  const relevantEvents: Array<{ time: number; type: 'start' | 'end' }> = [];

  for (let i = 0; i < networkRequests.length; i += 1) {
    const request = networkRequests[i];
    const reqStartTime = request.startTime;
    const reqEndTime = reqStartTime + request.duration;

    // Skip requests that don't overlap with our window
    if (reqEndTime <= startTime || reqStartTime >= endTime) {
      continue;
    }

    relevantEvents.push(
      { time: Math.max(reqStartTime, startTime), type: 'start' },
      { time: Math.min(reqEndTime, endTime), type: 'end' },
    );
  }

  // Early exit if no relevant events
  if (relevantEvents.length === 0) {
    return true;
  }

  // Sort events by time (this is now a smaller array)
  relevantEvents.sort((a, b) => a.time - b.time);

  // Process events to find max concurrent requests
  for (let i = 0; i < relevantEvents.length; i += 1) {
    const event = relevantEvents[i];
    if (event.type === 'start') {
      currentRequests += 1;
      maxConcurrentRequests = Math.max(maxConcurrentRequests, currentRequests);
      // Early exit optimization: if we already exceed 2, no need to continue
      if (maxConcurrentRequests > 2) {
        return false;
      }
    } else {
      currentRequests -= 1;
    }
  }

  return maxConcurrentRequests <= 2;
};

const findTTI = (
  fcpTime: number,
  longTasks: PerformanceEntry[],
  networkRequests: PerformanceEntry[],
): number => {
  const searchStartTime = fcpTime;
  const now = performance.now();

  // Sort long tasks by start time
  const sortedLongTasks = longTasks
    .filter((task) => task.startTime >= searchStartTime)
    .sort((a, b) => a.startTime - b.startTime);

  // Find a quiet window of 5 seconds
  for (let time = searchStartTime; time <= now - 5000; time += 100) {
    if (isQuietWindow(time, time + 5000, sortedLongTasks, networkRequests)) {
      // Found quiet window, now search backwards for last long task
      const lastLongTask = findLastLongTaskBefore(time, sortedLongTasks);
      return lastLongTask ? lastLongTask.startTime + lastLongTask.duration : fcpTime;
    }
  }

  // If no quiet window found, use current time
  const lastLongTask = sortedLongTasks[sortedLongTasks.length - 1];
  return lastLongTask ? lastLongTask.startTime + lastLongTask.duration : fcpTime;
};

// Global collection of all long tasks for consistent reporting
// eslint-disable-next-line prefer-const
let globalLongTasks: PerformanceEntry[] = [];
let globalLongTaskObserver: PerformanceObserver | null = null;

// Initialize global long task observer
const initializeGlobalLongTaskObserver = () => {
  if (globalLongTaskObserver || !('PerformanceObserver' in window)) {
    return;
  }

  globalLongTaskObserver = new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
      globalLongTasks.push(entry);
    }
  });

  try {
    globalLongTaskObserver.observe({ type: 'longtask', buffered: true });
  } catch {
    // Long task API not supported
    globalLongTaskObserver = null;
  }
};

// Calculate TBT (Total Blocking Time) between FCP and TTI
const calculateTBT = (fcpTime: number, ttiTime: number): number => {
  let totalBlockingTime = 0;

  for (const task of globalLongTasks) {
    // Only consider tasks between FCP and TTI
    if (task.startTime >= fcpTime && task.startTime < ttiTime) {
      // Only the portion above 50ms counts as blocking time
      const blockingTime = Math.max(0, task.duration - 50);
      totalBlockingTime += blockingTime;
    }
  }

  return totalBlockingTime;
};

// Calculate TTI and TBT based on the algorithm described
const calculateTTIAndTBT = (fcpTime: number): Promise<{ tti: number; tbt: number }> => {
  return new Promise((resolve) => {
    const networkRequests: PerformanceEntry[] = [];
    let intervalId: NodeJS.Timeout;
    let resourceObserver: PerformanceObserver | null = null;

    // Initialize the global long task observer if not already done
    initializeGlobalLongTaskObserver();

    // Collect all long tasks
    // (Using global observer initialized above)

    // Collect network requests
    if ('PerformanceObserver' in window) {
      resourceObserver = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          if (entry.name.startsWith('http') && entry.startTime >= fcpTime) {
            networkRequests.push(entry);
          }
        }
      });

      try {
        resourceObserver.observe({ type: 'resource', buffered: true });
      } catch {
        // Resource timing not supported
        resourceObserver = null;
      }
    }

    // Function to check for quiet window and calculate TTI
    const checkForTTI = () => {
      const now = performance.now();

      // Sort long tasks by start time for efficient processing
      const sortedLongTasks = globalLongTasks
        .filter((task) => task.startTime >= fcpTime)
        .sort((a, b) => a.startTime - b.startTime);

      // Check if we can find a quiet window
      for (let time = fcpTime; time <= now - 5000; time += 100) {
        if (isQuietWindow(time, time + 5000, sortedLongTasks, networkRequests)) {
          // Found quiet window! Calculate TTI and TBT, then resolve
          const lastLongTask = findLastLongTaskBefore(time, sortedLongTasks);
          const tti = lastLongTask ? lastLongTask.startTime + lastLongTask.duration : fcpTime;
          const tbt = calculateTBT(fcpTime, tti);

          // Clean up observers and interval
          clearInterval(intervalId);
          if (resourceObserver) {
            resourceObserver.disconnect();
          }

          resolve({ tti, tbt });
          return;
        }
      }
    };

    // Check every second for quiet window
    intervalId = setInterval(checkForTTI, 1000);

    // Fallback: if we haven't found TTI after 24.9 more seconds, calculate it anyway
    // (Total of 30 seconds from FCP: 5.1 second delay + 24.9 second search)
    setTimeout(() => {
      clearInterval(intervalId);
      if (resourceObserver) {
        resourceObserver.disconnect();
      }

      const tti = findTTI(fcpTime, globalLongTasks, networkRequests);
      const tbt = calculateTBT(fcpTime, tti);
      resolve({ tti, tbt });
    }, 24900); // Fallback after 24.9 more seconds (total 30s from FCP)
  });
};

// Report long tasks with callback pattern similar to web-vitals
const onLongTask = (callback: (metric: CustomMetric) => void) => {
  if (!('PerformanceObserver' in window)) {
    return;
  }

  // Initialize global observer if not already done
  initializeGlobalLongTaskObserver();

  // Create a separate observer just for reporting individual tasks with metadata
  const reportingObserver = new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
      // Try to extract better source information
      let source = 'JavaScript (main thread)'; // Default fallback
      const attribution = [];

      // Check if attribution data is available
      if ((entry as any).attribution && (entry as any).attribution.length > 0) {
        const attr = (entry as any).attribution[0];
        attribution.push({
          name: attr.name || 'unknown',
          entryType: attr.entryType || 'unknown',
          startTime: attr.startTime || 0,
          duration: attr.duration || 0,
          containerType: attr.containerType || 'unknown',
          containerSrc: attr.containerSrc || 'unknown',
          containerId: attr.containerId || 'unknown',
          containerName: attr.containerName || 'unknown',
        });

        // Try to determine a meaningful source name
        if (attr.containerSrc && attr.containerSrc !== 'unknown') {
          try {
            const url = new URL(attr.containerSrc);
            source = url.pathname.split('/').pop() || attr.containerSrc;
          } catch {
            source = attr.containerSrc;
          }
        } else if (attr.containerName && attr.containerName !== 'unknown') {
          source = attr.containerName;
        } else if (attr.name && attr.name !== 'unknown') {
          source = attr.name;
        }
      }

      // If no attribution, try to infer from current script context
      if (attribution.length === 0) {
        // Check if we can get current script information
        const currentScript = document.currentScript as HTMLScriptElement;
        if (currentScript && currentScript.src) {
          try {
            const url = new URL(currentScript.src);
            source = url.pathname.split('/').pop() || 'current-script';
          } catch {
            source = 'current-script';
          }
        } else {
          // Fallback to detecting if it's likely React/framework related
          const hasReact = (window as any).React !== undefined;
          // eslint-disable-next-line no-underscore-dangle
          const hasNextData = (window as any).__NEXT_DATA__ !== undefined;

          if (hasNextData) {
            source = 'Next.js';
          } else if (hasReact) {
            source = 'React';
          }
        }
      }

      // Call the callback with each long task and additional metadata
      callback({
        name: 'long-task',
        value: entry.duration,
        rating: getRating(entry.duration, { good: 50, poor: 100 }),
        entries: [entry],
        // Additional metadata for long tasks
        metadata: {
          startTime: entry.startTime,
          endTime: entry.startTime + entry.duration,
          attribution,
          source, // Simplified source name for display
          // Calculate timing relative to page load
          timeFromPageLoad: entry.startTime,
          severity: getLongTaskSeverity(entry.duration),
        },
      });
    }
  });

  try {
    reportingObserver.observe({ type: 'longtask', buffered: true });
  } catch {
    // Long task API not supported
    console.warn('Long Task API not supported');
  }
};

export function BenchProvider({ children }: { children: React.ReactNode }) {
  React.useEffect(() => {
    // Initialize global long task collection
    initializeGlobalLongTaskObserver();

    onCLS(report); // Measures Cumulative Layout Shift
    onFCP((metric) => {
      report(metric); // Report FCP first

      // Wait 5.1 seconds before starting TTI calculation to ensure we have enough
      // time for a potential 5-second quiet window to be meaningful
      setTimeout(() => {
        // Calculate and report TTI and TBT after sufficient time has passed
        calculateTTIAndTBT(metric.value)
          .then(({ tti, tbt }) => {
            // Report TTI
            report({
              name: 'TTI',
              value: tti,
              rating: getRating(tti, { good: 3800, poor: 5000 }),
              navigationType: metric.navigationType,
            });

            // Report TBT
            report({
              name: 'TBT',
              value: tbt,
              rating: getRating(tbt, { good: 200, poor: 600 }),
              navigationType: metric.navigationType,
            });
          })
          .catch(() => {
            // TTI/TBT calculation failed, ignore
          });
      }, 5100); // Wait 5.1 seconds after FCP before starting TTI calculation
    }); // Measures First Contentful Paint
    onLCP(report); // Measures Largest Contentful Paint
    onINP(report); // Measures Interaction to Next Paint

    // Start reporting long tasks
    onLongTask(report);
  }, []);

  return children;
}
