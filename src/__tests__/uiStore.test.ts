import { describe, it, expect, beforeEach } from 'vitest'
import { useUiStore } from '../stores/uiStore'

describe('uiStore', () => {
  beforeEach(() => {
    useUiStore.setState({
      activeLitePage: 'live',
      toasts: [],
      backendLogs: [],
      showDevicePicker: false,
      showModelPackager: false,
    })
  })

  it('sets active lite page', () => {
    useUiStore.getState().setActiveLitePage('history')
    expect(useUiStore.getState().activeLitePage).toBe('history')
    useUiStore.getState().setActiveLitePage('models')
    expect(useUiStore.getState().activeLitePage).toBe('models')
  })

  it('adds a toast', () => {
    useUiStore.getState().addToast({ message: 'Hello', type: 'info' })
    const toasts = useUiStore.getState().toasts
    expect(toasts).toHaveLength(1)
    expect(toasts[0].message).toBe('Hello')
    expect(toasts[0].type).toBe('info')
    expect(toasts[0].id).toBeDefined()
  })

  it('dismisses a toast by id', () => {
    useUiStore.getState().addToast({ message: 'A', type: 'success' })
    useUiStore.getState().addToast({ message: 'B', type: 'error' })
    const id = useUiStore.getState().toasts[0].id
    useUiStore.getState().dismissToast(id)
    const toasts = useUiStore.getState().toasts
    expect(toasts).toHaveLength(1)
    expect(toasts[0].message).toBe('B')
  })

  it('each toast gets a unique id', () => {
    useUiStore.getState().addToast({ message: 'A', type: 'info' })
    useUiStore.getState().addToast({ message: 'B', type: 'info' })
    const [t1, t2] = useUiStore.getState().toasts
    expect(t1.id).not.toBe(t2.id)
  })

  it('pushes backend logs', () => {
    useUiStore.getState().pushBackendLog('line 1')
    useUiStore.getState().pushBackendLog('line 2')
    expect(useUiStore.getState().backendLogs).toEqual(['line 1', 'line 2'])
  })

  it('backend logs cap at 500', () => {
    for (let i = 0; i < 510; i++) {
      useUiStore.getState().pushBackendLog(`line ${i}`)
    }
    const logs = useUiStore.getState().backendLogs
    expect(logs).toHaveLength(500)
    // oldest lines (0-9) should be gone; line 10 should be first
    expect(logs[0]).toBe('line 10')
    expect(logs[499]).toBe('line 509')
  })

  it('sets showDevicePicker', () => {
    useUiStore.getState().setShowDevicePicker(true)
    expect(useUiStore.getState().showDevicePicker).toBe(true)
  })

  it('sets showModelPackager', () => {
    useUiStore.getState().setShowModelPackager(true)
    expect(useUiStore.getState().showModelPackager).toBe(true)
  })
})
