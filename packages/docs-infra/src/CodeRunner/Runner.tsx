'use client';

import * as React from 'react';
import { generateElement } from './generateElement';
import type { RunnerOptions, Scope } from './types';

export interface RunnerProps extends RunnerOptions {
  /**
   * Called after every (re)render with the error that occurred while building or
   * rendering the code, or `undefined` when it rendered cleanly.
   */
  onRendered?: (error?: Error) => void;
}

interface RunnerState {
  element: React.ReactNode;
  error: Error | null;
  /** The code the current `element`/`error` was derived from. */
  renderedCode: string | null;
  /** The scope the current `element`/`error` was derived from (compared by reference). */
  renderedScope: Scope | undefined;
}

/** Normalizes an unknown thrown value into an `Error`. */
function toError(thrown: unknown): Error {
  return thrown instanceof Error ? thrown : new Error(String(thrown));
}

/**
 * Runs a source string and renders the React node it exports, doubling as an
 * error boundary so a runtime error thrown while rendering that node is caught
 * instead of tearing down the host tree. Build-time errors (transpile/evaluate)
 * and render-time errors are both reported through `onRendered`.
 *
 * Implemented as a class because error boundaries require
 * `getDerivedStateFromError`.
 */
export class Runner extends React.Component<RunnerProps, RunnerState> {
  state: RunnerState = {
    element: null,
    error: null,
    renderedCode: null,
    renderedScope: undefined,
  };

  static getDerivedStateFromProps(
    props: RunnerProps,
    state: RunnerState,
  ): Partial<RunnerState> | null {
    // Regenerate only when an input changed; unrelated re-renders keep the element.
    if (props.code === state.renderedCode && props.scope === state.renderedScope) {
      return null;
    }

    try {
      return {
        element: generateElement(props),
        error: null,
        renderedCode: props.code,
        renderedScope: props.scope,
      };
    } catch (error) {
      return {
        element: null,
        error: toError(error),
        renderedCode: props.code,
        renderedScope: props.scope,
      };
    }
  }

  static getDerivedStateFromError(error: unknown): Partial<RunnerState> {
    // A runtime error thrown while React rendered the generated node.
    return { error: toError(error) };
  }

  componentDidMount(): void {
    this.props.onRendered?.(this.state.error ?? undefined);
  }

  componentDidUpdate(): void {
    this.props.onRendered?.(this.state.error ?? undefined);
  }

  shouldComponentUpdate(nextProps: RunnerProps, nextState: RunnerState): boolean {
    return (
      nextProps.code !== this.props.code ||
      nextProps.scope !== this.props.scope ||
      nextState.error !== this.state.error ||
      // Re-render (so `componentDidUpdate` re-reports via `onRendered`) when the
      // callback changes even though the code/scope didn't — e.g. restoring the
      // source to the exact code the cached element last rendered. Without this,
      // `getDerivedStateFromProps` short-circuits, `onRendered` never fires, and a
      // pending error never clears. The regenerate itself is still skipped.
      nextProps.onRendered !== this.props.onRendered
    );
  }

  render(): React.ReactNode {
    return this.state.error ? null : this.state.element;
  }
}
