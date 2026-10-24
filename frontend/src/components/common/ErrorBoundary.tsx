import React from "react";

interface State {
  error: Error | null;
}

/**
 * So a thrown render shows what went wrong and offers a way out, instead of a
 * blank page. A voting app that loses a ballot because a receipt view threw would
 * be a nasty thing to have to explain, so the copy is explicit that nothing was
 * submitted.
 */
export class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  State
> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  render() {
    const { error } = this.state;
    if (error === null) return this.props.children;

    return (
      <div className="zv-page-container">
        <header className="zv-page-header">
          <h1 className="zv-page-title">This page could not be shown</h1>
          <p className="zv-page-subtitle">
            Nothing was submitted and nothing was recorded. The detail below is
            the browser&apos;s own message — reload to try again.
          </p>
        </header>
        <div className="zv-admin-section">
          <div className="zv-hash-block">
            <span className="zv-merkle-label">Error</span>
            <code className="zv-merkle-hash">{error.message || String(error)}</code>
          </div>
          <div className="zv-form-actions">
            <button
              type="button"
              className="zv-btn zv-btn-primary zv-btn-sm"
              onClick={() => window.location.reload()}
            >
              <span>Reload</span>
            </button>
          </div>
        </div>
      </div>
    );
  }
}
