import { useAuth } from './auth/useAuth'
import { Login } from './components/Login'
import { Chat } from './components/Chat'

export function App(): React.JSX.Element {
  const auth = useAuth()
  if (auth.state === 'loading') return <div className="app-shell">Loading…</div>
  if (auth.state === 'anon') return <Login onSubmit={auth.login} error={auth.error} />
  return <Chat />
}
