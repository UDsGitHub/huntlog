import { Component, type ReactNode } from 'react';

interface Props {
  fallback: ReactNode;
  children: ReactNode;
}

/** Keeps a failing section (e.g. a rejected live query) from blanking the whole panel. */
export class ErrorBoundary extends Component<Props, { failed: boolean }> {
  override state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  override componentDidCatch(error: unknown) {
    console.error('Section failed to render', error);
  }

  override render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}
