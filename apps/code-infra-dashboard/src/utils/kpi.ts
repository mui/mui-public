export type HealthLevel = 'ok' | 'warning' | 'problem' | 'unknown';

export function computeLevel(
  value: number | null,
  warning: number,
  problem: number,
  lowerIsBetter: boolean,
): HealthLevel {
  if (value == null) {
    return 'unknown';
  }

  if (lowerIsBetter) {
    if (value > problem) {
      return 'problem';
    }
    if (value > warning) {
      return 'warning';
    }
    return 'ok';
  }
  if (value < problem) {
    return 'problem';
  }
  if (value < warning) {
    return 'warning';
  }
  return 'ok';
}
