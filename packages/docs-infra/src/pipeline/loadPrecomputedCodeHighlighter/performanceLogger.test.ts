import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  logPerformance,
  createPerformanceLogger,
  nameMark,
  performanceMeasure,
} from './performanceLogger';

describe('performanceLogger', () => {
  describe('logPerformance', () => {
    let consoleWarnSpy: any;

    beforeEach(() => {
      consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    });

    afterEach(() => {
      consoleWarnSpy.mockRestore();
    });

    it('should log performance entries above the notable threshold', () => {
      const entry = {
        name: 'Test operation',
        duration: 150,
      } as PerformanceEntry;

      logPerformance(entry, 100, false);

      expect(consoleWarnSpy).toHaveBeenCalledWith(' 150ms - Test operation');
    });

    it('should not log performance entries below the notable threshold', () => {
      const entry = {
        name: 'Fast operation',
        duration: 50,
      } as PerformanceEntry;

      logPerformance(entry, 100, false);

      expect(consoleWarnSpy).not.toHaveBeenCalled();
    });

    it('should filter by context when filterContext is provided', () => {
      const matchingEntry = {
        name: 'Load - app/components/types.ts',
        duration: 150,
      } as PerformanceEntry;

      const nonMatchingEntry = {
        name: 'Load - app/other/types.ts',
        duration: 150,
      } as PerformanceEntry;

      logPerformance(matchingEntry, 100, false, 'app/components/types.ts');
      expect(consoleWarnSpy).toHaveBeenCalledWith(' 150ms - Load - app/components/types.ts');

      consoleWarnSpy.mockClear();

      logPerformance(nonMatchingEntry, 100, false, 'app/components/types.ts');
      expect(consoleWarnSpy).not.toHaveBeenCalled();
    });

    it('should log all entries when filterContext is not provided', () => {
      const entry1 = {
        name: 'Load - app/components/types.ts',
        duration: 150,
      } as PerformanceEntry;

      const entry2 = {
        name: 'Load - app/other/types.ts',
        duration: 150,
      } as PerformanceEntry;

      logPerformance(entry1, 100, false);
      expect(consoleWarnSpy).toHaveBeenCalledWith(' 150ms - Load - app/components/types.ts');

      consoleWarnSpy.mockClear();

      logPerformance(entry2, 100, false);
      expect(consoleWarnSpy).toHaveBeenCalledWith(' 150ms - Load - app/other/types.ts');
    });

    it('should handle wrapper measures with pipe delimiter', () => {
      const entry = {
        name: '| Wrapper operation',
        duration: 150,
      } as PerformanceEntry;

      logPerformance(entry, 100, true);

      expect(consoleWarnSpy).toHaveBeenCalledWith(' 150ms | Wrapper operation');
    });

    it('should not log wrapper measures when showWrapperMeasures is false', () => {
      const entry = {
        name: '| Wrapper operation',
        duration: 150,
      } as PerformanceEntry;

      logPerformance(entry, 100, false);

      expect(consoleWarnSpy).not.toHaveBeenCalled();
    });
  });

  describe('createPerformanceLogger', () => {
    let consoleWarnSpy: any;

    beforeEach(() => {
      consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    });

    afterEach(() => {
      consoleWarnSpy.mockRestore();
    });

    it('should create a logger that filters by context', () => {
      const logger = createPerformanceLogger(100, false, 'app/components/types.ts');

      const entries: PerformanceEntry[] = [
        { name: 'Load - app/components/types.ts', duration: 150 } as PerformanceEntry,
        { name: 'Load - app/other/types.ts', duration: 150 } as PerformanceEntry,
      ];

      const list = {
        getEntries: () => entries,
      } as PerformanceObserverEntryList;

      logger(list, {} as PerformanceObserver);

      // Should only log the matching entry
      expect(consoleWarnSpy).toHaveBeenCalledTimes(1);
      expect(consoleWarnSpy).toHaveBeenCalledWith(' 150ms - Load - app/components/types.ts');
    });

    it('should create a logger that logs all entries when no context filter', () => {
      const logger = createPerformanceLogger(100, false);

      const entries: PerformanceEntry[] = [
        { name: 'Load - app/components/types.ts', duration: 150 } as PerformanceEntry,
        { name: 'Load - app/other/types.ts', duration: 150 } as PerformanceEntry,
      ];

      const list = {
        getEntries: () => entries,
      } as PerformanceObserverEntryList;

      logger(list, {} as PerformanceObserver);

      // Should log both entries
      expect(consoleWarnSpy).toHaveBeenCalledTimes(2);
    });
  });

  describe('nameMark', () => {
    it('should format mark name with function, event, and context', () => {
      const result = nameMark('MyFunction', 'Start', ['file.ts']);
      expect(result).toBe('MyFunction - Start - file.ts');
    });

    it('should format mark name with multiple context items', () => {
      const result = nameMark('MyFunction', 'Process', ['file.ts', 'variant1']);
      expect(result).toBe('MyFunction - Process - file.ts - variant1');
    });

    it('should format wrapper marks with pipe delimiters', () => {
      const result = nameMark('MyFunction', 'Total Time', ['file.ts'], true);
      expect(result).toBe('| MyFunction | Total Time - file.ts');
    });
  });

  describe('performanceMeasure', () => {
    let performanceMarkSpy: any;
    let performanceMeasureSpy: any;

    beforeEach(() => {
      performanceMarkSpy = vi.spyOn(performance, 'mark');
      performanceMeasureSpy = vi.spyOn(performance, 'measure');
    });

    it('should create a mark and measure', () => {
      performance.mark('startMark');

      const result = performanceMeasure('startMark', { mark: 'processed', measure: 'processing' }, [
        'MyFunction',
        'file.ts',
      ]);

      expect(performanceMarkSpy).toHaveBeenCalledWith('MyFunction - processed - file.ts');
      expect(performanceMeasureSpy).toHaveBeenCalledWith(
        'MyFunction - processing - file.ts',
        'startMark',
        'MyFunction - processed - file.ts',
      );
      expect(result).toBe('MyFunction - processed - file.ts');
    });

    it('should support prefix in names', () => {
      performance.mark('startMark');

      const result = performanceMeasure(
        'startMark',
        { prefix: 'worker', mark: 'processed', measure: 'processing' },
        ['MyFunction', 'file.ts'],
        true,
      );

      expect(performanceMarkSpy).toHaveBeenCalledWith('| MyFunction | worker processed - file.ts');
      expect(performanceMeasureSpy).toHaveBeenCalledWith(
        '| MyFunction | worker processing - file.ts',
        'startMark',
        '| MyFunction | worker processed - file.ts',
      );
      expect(result).toBe('| MyFunction | worker processed - file.ts');
    });

    it('should work without startMark', () => {
      const result = performanceMeasure(undefined, { mark: 'loaded', measure: 'loading' }, [
        'MyFunction',
        'file.ts',
      ]);

      expect(performanceMarkSpy).toHaveBeenCalledWith('MyFunction - loaded - file.ts');
      expect(performanceMeasureSpy).toHaveBeenCalledWith(
        'MyFunction - loading - file.ts',
        undefined,
        'MyFunction - loaded - file.ts',
      );
      expect(result).toBe('MyFunction - loaded - file.ts');
    });

    it('should handle multiple context items', () => {
      performanceMeasure(undefined, { mark: 'done', measure: 'work' }, [
        'MyFunction',
        'variant1',
        'file.ts',
      ]);

      expect(performanceMarkSpy).toHaveBeenCalledWith('MyFunction - done - variant1 - file.ts');
      expect(performanceMeasureSpy).toHaveBeenCalledWith(
        'MyFunction - work - variant1 - file.ts',
        undefined,
        'MyFunction - done - variant1 - file.ts',
      );
    });
  });
});
