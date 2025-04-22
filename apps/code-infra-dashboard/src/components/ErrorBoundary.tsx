import * as React from 'react';

interface ErrorBoundaryProps {
  children: React.ReactNode;
  fallback: React.ReactNode;
}

interface ErrorBoundaryState {
  didThrow: boolean;
}

export default class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  static getDerivedStateFromError(): ErrorBoundaryState {
    return { didThrow: true };
  }

  state: ErrorBoundaryState = { didThrow: false };

  componentDidCatch(error: unknown): void {
    console.error(error);
  }

  render() {
    if (this.state.didThrow) {
      return this.props.fallback;
    }
    return this.props.children;
  }
}
