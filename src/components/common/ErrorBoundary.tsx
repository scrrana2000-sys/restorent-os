import React, { ErrorInfo, ReactNode } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends (React.Component as new (props: Props) => {
  props: Props;
  state: State;
  setState: (state: Partial<State>) => void;
  render(): ReactNode;
}) {
  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('[RestaurantOS ErrorBoundary] Uncaught error:', error, errorInfo);

    // Never reload the entire POS/application automatically after a render
    // error. Automatic reloads hide the actual runtime fault and can turn a
    // single component error into a visible "website keeps reloading" loop.
    // Keep the error visible so the user can recover deliberately.
  }

  constructor(props: Props) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
    };
  }

  private handleReload = () => {
    this.setState({ hasError: false, error: null });
    window.location.reload();
  };

  public render(): ReactNode {
    if (this.state && this.state.hasError) {
      return (
        <div className="min-h-screen bg-slate-900 text-slate-100 flex items-center justify-center p-6">
          <div className="max-w-md w-full bg-slate-800 border border-slate-700 rounded-2xl p-6 shadow-2xl text-center">
            <div className="w-12 h-12 bg-amber-500/10 text-amber-400 rounded-full flex items-center justify-center mx-auto mb-4 border border-amber-500/20">
              <AlertTriangle className="w-6 h-6" />
            </div>
            <h2 className="text-xl font-bold mb-2">Application Notice</h2>
            <p className="text-sm text-slate-400 mb-4">
              An unexpected render error occurred. The application has stopped this screen safely so the underlying error can be fixed without an automatic page reload.
            </p>
            {this.state.error && (
              <div className="bg-slate-950 text-amber-300 font-mono text-xs p-3 rounded-lg text-left overflow-x-auto mb-6 max-h-32 border border-slate-800">
                {String(this.state.error.message || this.state.error)}
              </div>
            )}
            <button
              type="button"
              onClick={this.handleReload}
              className="w-full py-2.5 px-4 bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-sm rounded-xl transition-colors flex items-center justify-center gap-2 shadow-lg shadow-indigo-600/20 cursor-pointer"
            >
              <RefreshCw className="w-4 h-4" />
              Reload Preview
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
