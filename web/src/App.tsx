import { Component, type ReactNode } from 'react'
import { useAuth } from './auth/useAuth'
import { Login } from './components/Login'
import { Chat } from './components/Chat'
import { ToastProvider } from './components/Toast'

/** Bare-bones error boundary so a render-time throw shows a recoverable message
 *  instead of blanking the whole app to a white screen. */
class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null }
  static getDerivedStateFromError(error: Error) { return { error } }
  render() {
    if (this.state.error) {
      return (
        <div className="app-shell" style={{ flexDirection: 'column', gap: 12, padding: 24 }}>
          <p style={{ margin: 0 }}>Something went wrong rendering the app.</p>
          <button
            onClick={() => location.reload()}
            style={{ padding: '8px 16px', borderRadius: 8, border: 0, background: 'var(--accent)', color: '#fff', cursor: 'pointer' }}
          >
            Reload
          </button>
        </div>
      )
    }
    return this.props.children
  }
}

export function App(): React.JSX.Element {
  const auth = useAuth()
  let body: React.JSX.Element
  if (auth.state === 'loading') body = <div className="app-shell">Loading…</div>
  else if (auth.state === 'anon') body = <Login onSubmit={auth.login} error={auth.error} />
  else body = <Chat onLogout={auth.logout} />
  return (
    <ErrorBoundary>
      <ToastProvider>{body}</ToastProvider>
    </ErrorBoundary>
  )
}
