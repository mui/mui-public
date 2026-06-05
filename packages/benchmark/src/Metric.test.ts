import { describe, it, expect } from 'vitest';
import { ScalarMetric } from './ScalarMetric';
import { DiscreteMetric } from './DiscreteMetric';

describe('Metric.record', () => {
  it('throws when two different metrics share a name in the same test', () => {
    const timing = new ScalarMetric({ name: 'shared' });
    const count = new DiscreteMetric({ name: 'shared' });
    timing.record(1);
    expect(() => count.record(2)).toThrow(/share the name "shared"/);
  });

  it('allows the same instance to record many values under one name', () => {
    const metric = new ScalarMetric({ name: 'reused' });
    expect(() => {
      metric.record(1);
      metric.record(2, { id: 'sub' });
    }).not.toThrow();
  });
});

describe('ScalarMetric.timeEnd', () => {
  it('throws when called without a matching time()', () => {
    const metric = new ScalarMetric({ name: 'timer' });
    expect(() => metric.timeEnd()).toThrow(/without a matching time/);
  });

  it('throws when the label does not match an open timer', () => {
    const metric = new ScalarMetric({ name: 'labelled-timer' });
    metric.time('a');
    expect(() => metric.timeEnd('b')).toThrow(/without a matching time/);
  });
});
