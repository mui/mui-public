import { Component } from "react";

export default class ErrorBoundary extends Component {
  static getDerivedStateFromError(error) {
    return { didThrow: true };
  }

  state = { didThrow: false };

  componentDidCatch(error) {
    console.error(error);
  }

  render() {
    if (this.state.didThrow) {
      return this.props.fallback;
    }
    return this.props.children;
  }
}
