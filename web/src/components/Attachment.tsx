import type { AttachmentMeta } from '../api/types'
import styles from './Attachment.module.css'

export function Attachment({ meta }: { meta: AttachmentMeta }): React.JSX.Element {
  const src = `/api/attachments/${encodeURIComponent(meta.id)}`
  if (meta.contentType?.startsWith('image/')) {
    return <img className={styles.image} src={src} alt={meta.filename ?? 'image attachment'} loading="lazy" />
  }
  return <a className={styles.file} href={src} download>{meta.filename ?? 'Attachment'}</a>
}
