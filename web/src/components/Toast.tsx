import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import styles from './Toast.module.css'

interface Toast {
  id: number
  message: string
  kind: 'error' | 'info'
}

interface ToastApi {
  error: (message: string) => void
  info: (message: string) => void
}

const ToastContext = createContext<ToastApi | null>(null)

let nextId = 1

export function ToastProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const [toasts, setToasts] = useState<Toast[]>([])
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>())

  const remove = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id))
    const timer = timers.current.get(id)
    if (timer) { clearTimeout(timer); timers.current.delete(id) }
  }, [])

  const push = useCallback((message: string, kind: 'error' | 'info') => {
    const id = nextId++
    setToasts((prev) => [...prev, { id, message, kind }])
    // Auto-dismiss after 4s; errors stay a little longer.
    timers.current.set(id, setTimeout(() => remove(id), kind === 'error' ? 5000 : 3500))
  }, [remove])

  const api: ToastApi = {
    error: (m) => push(m, 'error'),
    info: (m) => push(m, 'info'),
  }

  useEffect(() => () => { timers.current.forEach((t) => clearTimeout(t)); timers.current.clear() }, [])

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className={styles.stack} role="region" aria-label="Notifications" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`${styles.toast} ${t.kind === 'error' ? styles.error : styles.info}`} role="alert">
            <span className={styles.message}>{t.message}</span>
            <button className={styles.closeBtn} aria-label="Dismiss" onClick={() => remove(t.id)}>×</button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be used within ToastProvider')
  return ctx
}
