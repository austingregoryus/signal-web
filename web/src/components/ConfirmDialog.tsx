import { useEffect } from 'react'
import styles from './ConfirmDialog.module.css'

/**
 * Small reusable confirmation modal. Closes on backdrop click, the cancel
 * button, or Escape. `destructive` styles the confirm button red — use for
 * irreversible actions like delete.
 */
export function ConfirmDialog({
  title, message, confirmLabel = 'Confirm', cancelLabel = 'Cancel', destructive = false,
  onConfirm, onCancel,
}: {
  title: string
  message: string
  confirmLabel?: string
  cancelLabel?: string
  destructive?: boolean
  onConfirm: () => void
  onCancel: () => void
}): React.JSX.Element {
  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') onCancel()
    }
    document.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [onCancel])

  return (
    <div className={styles.overlay} onClick={(e) => { if (e.target === e.currentTarget) onCancel() }} role="presentation">
      <div className={styles.modal} role="alertdialog" aria-modal="true" aria-labelledby={styles.title}>
        <h2 className={styles.title} id={styles.title}>{title}</h2>
        <p className={styles.message}>{message}</p>
        <div className={styles.actions}>
          <button type="button" className={styles.cancelBtn} onClick={onCancel}>{cancelLabel}</button>
          <button
            type="button"
            className={`${styles.confirmBtn} ${destructive ? styles.destructive : ''}`}
            onClick={onConfirm}
            autoFocus
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
