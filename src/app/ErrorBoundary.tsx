import { Component, type ErrorInfo, type ReactNode } from 'react';

interface ErrorBoundaryState {
  failed: boolean;
}

export class ErrorBoundary extends Component<{ children: ReactNode }, ErrorBoundaryState> {
  state: ErrorBoundaryState = { failed: false };

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('SweetSpot render failure', error, info.componentStack);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <main className="fatal-error" role="alert">
        <span className="brand-mark">S</span>
        <h1>SweetSpot hit an unexpected problem</h1>
        <p>Your last saved workspace should still be available.</p>
        <button type="button" onClick={() => window.location.reload()}>
          Reload workspace
        </button>
      </main>
    );
  }
}
