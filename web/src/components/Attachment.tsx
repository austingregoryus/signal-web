import { useEffect, useState } from 'react'
import type { AttachmentMeta } from '../api/types'
import styles from './Attachment.module.css'

export function Attachment({ meta }: { meta: AttachmentMeta }): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const src = `/api/attachments/${encodeURIComponent(meta.id)}`
  const isImage = meta.contentType?.startsWith('image/')

  if (isImage) {
    return (
      <>
        <img
          className={styles.image}
          src={src}
          alt={meta.filename ?? 'image attachment'}
          loading="lazy"
          onClick={() => setOpen(true)}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpen(true) } }}
          tabIndex={0}
        />
        {open ? <Lightbox src={src} alt={meta.filename ?? 'image attachment'} onClose={() => setOpen(false)} /> : null}
      </>
    )
  }
  return <a className={styles.file} href={src} download>{meta.filename ?? 'Attachment'}</a>
}

function Lightbox({ src, alt, onClose }: { src: string; alt: string; onClose: () => void }): React.JSX.Element {
  // Close on Escape; lock background scroll while open.
  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prevOverflow
    }
  }, [onClose])

  return (
    <div
      className={styles.lightbox}
      role="dialog"
      aria-modal="true"
      aria-label="Image preview"
      onClick={onClose}
    >
      <button className={styles.lightboxClose} type="button" aria-label="Close" onClick={onClose}>×</button>
      {/* Stop the image click from bubbling to the backdrop (which closes). */}
      <img
        className={styles.lightboxImg}
        src={src}
        alt={alt}
        onClick={(e) => e.stopPropagation()}
      />
    </div>
  )
}
