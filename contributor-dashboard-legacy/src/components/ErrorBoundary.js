import * as React from "react";

export default class ErrorBoundary extends React.Component {
	static getDerivedStateFromError() {
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
