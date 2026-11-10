import {StrictMode, Component, ReactNode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';

/**
 * The last line of defence: a screen failed to draw.
 *
 * Two cases, told apart by the error:
 *  - A part of the app could not be downloaded. Screens used less often load
 *    when first opened, by file names that change with every build — so a tab
 *    left open across an Update asks the server for files that are gone. The
 *    cure is to reload.
 *  - Anything else: a fault in the app. Reloading usually gets the user going
 *    again, and the details are there to copy into a bug report.
 *
 * Either way the user's work is not at risk — it is in the browser's storage
 * and in their Sheet — and the screen says so, in the app's own look, instead
 * of a red stack trace.
 */
const MISSING_PART = /dynamically imported module|module script failed|Loading chunk|Unable to preload|error loading dynamically/i;

class ErrorBoundary extends Component<{children: ReactNode}, {hasError: boolean, error: any}> {
  constructor(props: any) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: any) {
    return { hasError: true, error };
  }

  componentDidCatch(error: any, errorInfo: any) {
    console.error("Uncaught error:", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      const text = String(this.state.error?.message || this.state.error || '');
      const updated = MISSING_PART.test(text);
      return (
        <div className="fixed inset-0 bg-qb-bg overflow-y-auto flex items-center justify-center p-6">
          <div className="max-w-xl w-full border border-qb-light-grey p-6 sm:p-8 relative">
            <span className="absolute top-0 right-0 w-2 h-2 bg-qb-orange" />
            <h1 className="text-xl font-black uppercase tracking-widest text-qb-black">
              {updated ? 'PM Codex was updated' : 'This screen hit a problem'}
            </h1>
            <p className="mt-4 text-sm leading-relaxed text-qb-black">
              {updated
                ? 'This tab is still running the version from before the update. Reload it to carry on.'
                : 'Something in the app failed while drawing this screen. Reload the tab to carry on.'}
            </p>
            <p className="mt-2 text-sm leading-relaxed text-qb-dark-grey">
              Your work is not affected: it is kept in this browser and in your Google Sheet.
            </p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="mt-6 bg-qb-black text-white px-8 py-3 text-sm font-black uppercase tracking-widest hover:bg-qb-orange transition-colors cursor-pointer"
            >
              Reload
            </button>
            {!updated && (
              <details className="mt-6">
                <summary className="text-[10px] font-black uppercase tracking-widest text-qb-grey hover:text-qb-black cursor-pointer">
                  Details, for a bug report
                </summary>
                <pre className="mt-3 text-[10px] font-mono text-qb-dark-grey whitespace-pre-wrap break-words max-h-64 overflow-y-auto border border-qb-light-grey p-3">
                  {text}{this.state.error?.stack ? `\n\n${this.state.error.stack}` : ''}
                </pre>
              </details>
            )}
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
