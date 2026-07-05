import { useState, type FormEvent } from 'react'
import styles from './Login.module.css'

export function Login({ onSubmit, error }: { onSubmit: (pw: string) => void; error?: string }): React.JSX.Element {
  const [pw, setPw] = useState('')
  function submit(e: FormEvent): void { e.preventDefault(); onSubmit(pw) }
  return (
    <form className={styles.card} onSubmit={submit}>
      <h1>Signal Web</h1>
      <p className={styles.sub}>Sign in to read your messages</p>
      <input
        className={styles.input} type="password" autoFocus placeholder="Password"
        value={pw} onChange={(e) => setPw(e.target.value)} aria-label="Password"
      />
      {error && <div className={styles.error} role="alert">{error}</div>}
      <button className={styles.btn} type="submit">Sign in</button>
      <p className={styles.hint}>If you have a security key, you'll be asked to tap it after your password.</p>
    </form>
  )
}
