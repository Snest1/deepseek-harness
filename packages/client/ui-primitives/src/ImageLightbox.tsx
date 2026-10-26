import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { IconCheckOutlineRegular, IconCloseOutlineRegular, IconCopyOutlineRegular } from './icons/index.tsx'
import css from './ImageLightbox.module.css'

/** Lightbox strings the owner resolves from its own locale namespace. */
export interface ImageLightboxLabels {
  /** Accessible name of the preview dialog. */
  dialog: string
  /** Accessible label of the close control. */
  close: string
  /** Accessible label of the copy control and context-menu command. */
  copy: string
  /** Feedback only after the OS accepts the image into the clipboard. */
  copied: string
  /** Feedback when reading/converting the image or writing the clipboard fails. */
  copyFailed: string
}

/** Clipboard's widely supported bitmap format is PNG; never copy the image URL. */
async function imagePngBlob(src: string): Promise<Blob> {
  const response = await fetch(src)
  if (!response.ok) throw new Error('Could not read image')
  const blob = await response.blob()
  if (blob.type === 'image/png') return blob

  // JPEG/WebP/GIF need lossless PNG pixels on the clipboard. Use the natural
  // dimensions, not the downscaled/cropped preview displayed by the lightbox.
  const bitmap = await createImageBitmap(blob)
  try {
    const canvas = document.createElement('canvas')
    canvas.width = bitmap.width
    canvas.height = bitmap.height
    const context = canvas.getContext('2d')
    if (context === null) throw new Error('Cannot convert image')
    context.drawImage(bitmap, 0, 0)
    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((png) => {
        if (png === null) reject(new Error('Cannot encode PNG'))
        else resolve(png)
      }, 'image/png')
    })
  } finally {
    bitmap.close()
  }
}

/** Call write synchronously from the click gesture; Chromium accepts a
 * promised PNG Blob in ClipboardItem so decoding doesn't lose user activation. */
export function copyImageToClipboard(src: string): Promise<void> {
  const clipboard = Reflect.get(navigator, 'clipboard') as Clipboard | undefined
  if (typeof ClipboardItem === 'undefined' || clipboard?.write === undefined) {
    return Promise.reject(new Error('Image clipboard unavailable'))
  }
  try {
    return clipboard.write([new ClipboardItem({ 'image/png': imagePngBlob(src) })])
  } catch (error) {
    return Promise.reject(error instanceof Error ? error : new Error(String(error)))
  }
}

/**
 * Document-level original-image preview opened by clicking a thumbnail.
 * Copy operates on the original image (not the thumbnail or a screenshot).
 * Closes on Escape, backdrop press, or the close control, and restores focus
 * to the opener on unmount. Rendered through a body portal.
 */
export function ImageLightbox({ src, alt, labels, onClose }: {
  src: string
  alt: string
  labels: ImageLightboxLabels
  onClose: () => void
}) {
  const closeRef = useRef<HTMLButtonElement | null>(null)
  const copyRef = useRef<HTMLButtonElement | null>(null)
  const menuRef = useRef<HTMLButtonElement | null>(null)
  const restoreRef = useRef<HTMLElement | null>(null)
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  const [copyResult, setCopyResult] = useState<'copied' | 'failed' | null>(null)

  const copy = (): void => {
    setMenu(null)
    setCopyResult(null)
    void copyImageToClipboard(src)
      .then(() => { setCopyResult('copied') })
      .catch(() => { setCopyResult('failed') })
  }

  useEffect(() => {
    restoreRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    closeRef.current?.focus()
    return () => { restoreRef.current?.focus() }
  }, [])

  useEffect(() => {
    if (menu !== null) menuRef.current?.focus()
    const onKeyDown = (event: globalThis.KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        if (menu !== null) setMenu(null)
        else onClose()
      }
      if (event.key === 'Tab') {
        event.preventDefault()
        const controls = [copyRef.current, closeRef.current, menu === null ? null : menuRef.current]
          .filter((button): button is HTMLButtonElement => button !== null)
        const index = controls.findIndex(button => button === document.activeElement)
        const direction = event.shiftKey ? -1 : 1
        controls[(index + direction + controls.length) % controls.length]?.focus()
      }
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => { window.removeEventListener('keydown', onKeyDown, true) }
  }, [menu, onClose])

  return createPortal(
    <div className={css.backdrop} role="dialog" aria-modal="true" aria-label={labels.dialog}>
      <div className={css.stage}>
        <div className={css.mask} aria-hidden="true" onMouseDown={onClose} />
        <img className={css.image} src={src} alt={alt}
          onClick={() => { setMenu(null) }}
          onContextMenu={(event) => {
            event.preventDefault()
            setMenu({
              x: Math.max(8, Math.min(event.clientX, window.innerWidth - 190)),
              y: Math.max(8, Math.min(event.clientY, window.innerHeight - 52)),
            })
          }} />
        {copyResult !== null && (
          <span className={css.copyResult} role="status">
            {copyResult === 'copied' ? labels.copied : labels.copyFailed}
          </span>
        )}
        <button ref={copyRef} type="button" className={css.copy} aria-label={labels.copy}
          title={labels.copy} onClick={copy}>
          {copyResult === 'copied' ? <IconCheckOutlineRegular size={16} /> : <IconCopyOutlineRegular size={16} />}
        </button>
        <button ref={closeRef} type="button" className={css.close} aria-label={labels.close} onClick={onClose}>
          <IconCloseOutlineRegular size={16} />
        </button>
        {menu !== null && (
          <div className={css.contextMenu} role="menu" style={{ left: menu.x, top: menu.y }}>
            <button ref={menuRef} type="button" role="menuitem" onClick={copy}>
              <IconCopyOutlineRegular size={16} /> {labels.copy}
            </button>
          </div>
        )}
      </div>
    </div>,
    document.body,
  )
}
