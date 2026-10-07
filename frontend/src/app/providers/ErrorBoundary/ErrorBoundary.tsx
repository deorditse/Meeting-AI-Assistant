import { Component, type ErrorInfo, type ReactNode } from 'react';

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    window.m2a?.log(`React renderer error: ${error.message}\n${info.componentStack ?? ''}`);
  }

  render() {
    if (this.state.error) {
      return (
        <main className="renderer-error" role="alert">
          <strong>M2A could not render the interface.</strong>
          <span>{this.state.error.message}</span>
        </main>
      );
    }

    return this.props.children;
  }
}
