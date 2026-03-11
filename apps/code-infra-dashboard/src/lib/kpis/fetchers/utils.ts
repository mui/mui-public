import type { KpiResult } from '../types';

// Create a simple error result
export function errorResult(message: string): KpiResult {
  return { value: null, error: message };
}

// Create a success result with optional metadata
export function successResult(value: number, metadata?: string): KpiResult {
  return metadata ? { value, metadata } : { value };
}

// Returns error result if env var missing, otherwise returns the value
export function getEnvOrError(name: string): string | KpiResult {
  const value = process.env[name];
  if (!value) {
    return errorResult(`${name} not configured`);
  }
  return value;
}

// Returns error result if response not ok, otherwise null
export function checkHttpError(response: Response, context?: string): KpiResult | null {
  if (!response.ok) {
    const msg = context ? `${context} HTTP ${response.status}` : `HTTP ${response.status}`;
    return errorResult(msg);
  }
  return null;
}
