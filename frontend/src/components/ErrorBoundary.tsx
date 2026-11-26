import { Component, type ErrorInfo, type ReactNode } from 'react'

interface Props {
  children: ReactNode
}

interface State {
  error: Error | null
}

/**
 * Last line of defence: an uncaught render/effect error used to unmount the
 * whole app and leave a blank page. Show what happened and a way out instead.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Unhandled UI error:', error, info.componentStack)
  }

  render() {
    const { error } = this.state
    if (!error) return this.props.children
    return (
      <div role="alert" className="min-h-screen flex items-center justify-center bg-sp-bg p-6">
        <div className="max-w-md w-full rounded-xl border border-sp-divider/50 bg-sp-user p-6 text-center">
          <h1 className="text-lg font-semibold text-sp-text">Something went wrong</h1>
          <p className="mt-2 text-sm text-sp-muted">
            The app hit an unexpected error. Reloading usually fixes it.
          </p>
          <pre className="mt-4 max-h-32 overflow-auto rounded bg-black/30 p-2 text-left text-xs text-sp-muted whitespace-pre-wrap">
            {error.message}
          </pre>
          <div className="mt-5 flex justify-center gap-2">
            <button className="btn" onClick={() => window.location.reload()}>
              Reload
            </button>
            <button
              className="btn bg-transparent border border-sp-divider/50"
              onClick={() => window.location.assign('/channels/@me')}
            >
              Go home
            </button>
          </div>
        </div>
      </div>
    )
  }
}
