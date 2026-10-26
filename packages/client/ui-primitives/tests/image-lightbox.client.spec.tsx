// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { ImageLightbox } from '../src/ImageLightbox.tsx'

afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); delete (navigator as { clipboard?: unknown }).clipboard })

const labels = { dialog: '原图预览', close: '关闭原图预览', copy: '复制图片', copied: '已复制图片', copyFailed: '无法复制图片' }

describe('ImageLightbox', () => {
  it('focuses its close control, closes by button and Escape, and restores focus', () => {
    const opener = document.createElement('button')
    document.body.appendChild(opener)
    opener.focus()
    const onClose = vi.fn()
    const view = render(<ImageLightbox src="blob:original" alt="原图" labels={labels} onClose={onClose} />)
    const close = view.getByRole('button', { name: '关闭原图预览' })
    expect(document.activeElement).toBe(close)
    fireEvent.keyDown(window, { key: 'a' })
    expect(onClose).not.toHaveBeenCalled()
    const outerKey = vi.fn()
    document.body.addEventListener('keydown', outerKey)
    try {
      fireEvent.keyDown(close, { key: 'Escape' })
      expect(outerKey).not.toHaveBeenCalled()
    } finally { document.body.removeEventListener('keydown', outerKey) }
    fireEvent.click(close)
    expect(onClose).toHaveBeenCalledTimes(2)
    view.unmount()
    expect(document.activeElement).toBe(opener)
    opener.remove()
  })

  it('tolerates a focus owner it cannot restore (no active element at mount)', () => {
    // jsdom always reports body as the fallback active element; stub the
    // element-less state a detached focus can leave.
    Object.defineProperty(document, 'activeElement', { configurable: true, get: () => null })
    try {
      const view = render(<ImageLightbox src="blob:original" alt="原图" labels={labels} onClose={vi.fn()} />)
      view.unmount()
    } finally {
      delete (document as { activeElement?: unknown }).activeElement
    }
  })

  it('closes on a mask press but not on a press over the image', () => {
    const onClose = vi.fn()
    const view = render(<ImageLightbox src="blob:original" alt="原图" labels={labels} onClose={onClose} />)
    fireEvent.mouseDown(view.getByRole('img'))
    expect(onClose).not.toHaveBeenCalled()
    const mask = document.querySelector('[aria-hidden="true"]') as HTMLElement
    fireEvent.mouseDown(mask)
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})

describe('ImageLightbox clipboard', () => {
  function mockClipboard(blob: Blob, options?: { reject?: boolean }) {
    const fetch = vi.fn().mockResolvedValue({ ok: true, blob: async () => blob })
    vi.stubGlobal('fetch', fetch)
    class FakeClipboardItem {
      readonly items: Record<string, Promise<Blob>>
      constructor(items: Record<string, Promise<Blob>>) { this.items = items }
    }
    vi.stubGlobal('ClipboardItem', FakeClipboardItem)
    const written: Blob[] = []
    const write = vi.fn(async (items: FakeClipboardItem[]) => {
      // The write is invoked while user activation is still live; Chromium
      // awaits this Blob Promise internally for JPEG/WebP conversion.
      const image = await items[0]!.items['image/png']
      written.push(image!)
      if (options?.reject) throw new Error('permission denied')
    })
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { write } })
    return { fetch, write, written }
  }

  it('copies original PNG bytes from the button, not the thumbnail URL', async () => {
    const bytes = new Blob(['original pixels'], { type: 'image/png' })
    const { write, written, fetch } = mockClipboard(bytes)
    const view = render(<ImageLightbox src="blob:original" alt="original" labels={labels} onClose={vi.fn()} />)
    fireEvent.click(view.getByRole('button', { name: '复制图片' }))
    expect(write).toHaveBeenCalledTimes(1)
    await waitFor(() => { expect(view.getByRole('status').textContent).toBe('已复制图片') })
    expect(written[0]).toBe(bytes)
    expect(fetch).toHaveBeenCalledWith('blob:original')
  })

  it('right-click offers copying; Escape first closes menu, then preview', async () => {
    const { write } = mockClipboard(new Blob(['ok'], { type: 'image/png' }))
    const onClose = vi.fn()
    const view = render(<ImageLightbox src="blob:original" alt="original" labels={labels} onClose={onClose} />)
    fireEvent.contextMenu(view.getByRole('img'), { clientX: 100, clientY: 120 })
    const command = view.getByRole('menuitem', { name: '复制图片' })
    expect(document.activeElement).toBe(command)
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(view.queryByRole('menu')).toBeNull()
    expect(onClose).not.toHaveBeenCalled()
    fireEvent.contextMenu(view.getByRole('img'), { clientX: 50, clientY: 50 })
    fireEvent.click(view.getByRole('menuitem', { name: '复制图片' }))
    await waitFor(() => { expect(view.getByRole('status').textContent).toBe('已复制图片') })
    expect(write).toHaveBeenCalledTimes(1)
    expect(view.queryByRole('menu')).toBeNull()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it.each(['image/jpeg', 'image/webp', 'image/gif'])('converts %s pixels to PNG for the system clipboard', async (mediaType) => {
    const { written } = mockClipboard(new Blob(['encoded pixels'], { type: mediaType }))
    const bitmap = { width: 800, height: 400, close: vi.fn() }
    vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue(bitmap))
    const drawImage = vi.fn()
    const png = new Blob(['converted pixels'], { type: 'image/png' })
    let dimensions: { width: number; height: number } | undefined
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (this: HTMLCanvasElement) {
      dimensions = { width: this.width, height: this.height }
      return { drawImage } as unknown as CanvasRenderingContext2D
    })
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((callback) => { callback(png) })
    const view = render(<ImageLightbox src="blob:other-format" alt="source image" labels={labels} onClose={vi.fn()} />)
    fireEvent.click(view.getByRole('button', { name: '复制图片' }))
    await waitFor(() => { expect(view.getByRole('status').textContent).toBe('已复制图片') })
    expect(dimensions?.width).toBe(800)
    expect(dimensions?.height).toBe(400)
    expect(drawImage).toHaveBeenCalledWith(bitmap, 0, 0)
    expect(bitmap.close).toHaveBeenCalledOnce()
    expect(written).toEqual([png])
  })

  it('reports denied clipboard permissions rather than claiming success', async () => {
    mockClipboard(new Blob(['data'], { type: 'image/png' }), { reject: true })
    const view = render(<ImageLightbox src="blob:original" alt="original" labels={labels} onClose={vi.fn()} />)
    fireEvent.click(view.getByRole('button', { name: '复制图片' }))
    await waitFor(() => { expect(view.getByRole('status').textContent).toBe('无法复制图片') })
  })
})
