'use client';

import * as React from 'react';

export interface ErrorBoundaryProps {
  children: React.ReactNode;
  /** Called with the error thrown while rendering `children`. */
  onError?: (error: Error) => void;
  /**
   * When any value in this array changes, a caught error is cleared and
   * `children` render again — letting a fixed input recover from a prior crash.
   */
  resetKeys?: ReadonlyArray<unknown>;
  /** Rendered in place of `children` while an error is caught. Defaults to `null`. */
  fallback?: React.ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
  /** The `resetKeys` the current state was derived from, compared element-wise. */
  resetKeys: ReadonlyArray<unknown>;
}

/** Normalizes an unknown thrown value into an `Error`. */
function toError(thrown: unknown): Error {
  return thrown instanceof Error ? thrown : new Error(String(thrown));
}

/** Whether two reset-key arrays differ in length or any element (`Object.is`). */
function resetKeysChanged(a: ReadonlyArray<unknown>, b: ReadonlyArray<unknown>): boolean {
  return a.length !== b.length || a.some((value, index) => !Object.is(value, b[index]));
}

/**
 * Generic error boundary: catches errors thrown while rendering its subtree,
 * reports them through `onError`, and renders `fallback` instead of tearing down
 * the surrounding tree. Pass `resetKeys` (e.g. the live-edited source) so a fixed
 * input retries rendering after a previous crash.
 *
 * Implemented as a class because error boundaries require `getDerivedStateFromError`.
 */
export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null, resetKeys: this.props.resetKeys ?? [] };

  static getDerivedStateFromError(error: unknown): Partial<ErrorBoundaryState> {
    return { error: toError(error) };
  }

  static getDerivedStateFromProps(
    props: ErrorBoundaryProps,
    state: ErrorBoundaryState,
  ): Partial<ErrorBoundaryState> | null {
    const nextKeys = props.resetKeys ?? [];
    if (!resetKeysChanged(state.resetKeys, nextKeys)) {
      return null;
    }
    // Inputs changed — clear any caught error so the children render again.
    return { error: null, resetKeys: nextKeys };
  }

  componentDidCatch(error: unknown): void {
    this.props.onError?.(toError(error));
  }

  render(): React.ReactNode {
    return this.state.error ? (this.props.fallback ?? null) : this.props.children;
  }
}
