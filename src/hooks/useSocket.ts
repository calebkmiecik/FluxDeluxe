import { useEffect } from 'react'
import { getSocket } from '../lib/socket'
import { extractDeviceFrames } from '../lib/frameParser'
import { useDeviceStore, type ModelMetadata } from '../stores/deviceStore'
import { useSessionStore } from '../stores/sessionStore'
import { useLiveDataStore } from '../stores/liveDataStore'
import { useUiStore } from '../stores/uiStore'
import type { SocketResponse } from '../lib/types'

/** DynamoPy events vary: some send raw data, some use {status, data} envelope.
 *  This helper extracts the payload from either format. */
function unwrapPayload(data: unknown): unknown {
  if (typeof data === 'object' && data !== null && 'status' in (data as Record<string, unknown>)) {
    const resp = data as SocketResponse
    return resp.status === 'success' ? resp.data : null
  }
  return data // raw payload
}

/** Fire the initial volley of "give me current state" emits. Called on socket
 *  `connect` and also immediately if the socket is already connected when the
 *  effect mounts (StrictMode remount / HMR). */
function emitInitialRequests(socket: ReturnType<typeof getSocket>): void {
  socket.emit('getConnectedDevices')
  socket.emit('getDynamoConfig')
  socket.emit('getGroups')
  socket.emit('getGroupDefinitions')
  socket.emit('getDeviceSettings')
  socket.emit('getDeviceTypes')
}

export function useSocket(): void {
  useEffect(() => {
    const socket = getSocket()
    const deviceStore = useDeviceStore.getState()
    const sessionStore = useSessionStore.getState()
    const uiStore = useUiStore.getState()

    // Track every handler we attach so cleanup can remove them surgically.
    // NEVER call socket.removeAllListeners() — that can strip internal socket.io
    // listeners and leave a silently-broken connection.
    type Handler = (...args: unknown[]) => void
    const handlers: [string, Handler][] = []
    const on = (event: string, handler: Handler) => {
      socket.on(event, handler)
      handlers.push([event, handler])
    }

    // Connection lifecycle
    on('connect', () => {
      deviceStore.setConnectionState('DISCOVERING_DEVICES')
      emitInitialRequests(socket)
    })

    on('disconnect', () => {
      deviceStore.setConnectionState('DISCONNECTED')
    })

    on('connect_error', () => {
      deviceStore.setConnectionState('ERROR')
    })

    // If socket is already connected when the effect mounts (StrictMode remount
    // or HMR re-run), the `connect` event won't fire again — fire the initial
    // volley manually so we don't silently stall.
    if (socket.connected) {
      deviceStore.setConnectionState('DISCOVERING_DEVICES')
      emitInitialRequests(socket)
    }

    // Device events
    // connectedDeviceList sends raw groups array (NOT wrapped in {status, data})
    on('connectedDeviceList', (data: unknown) => {
      const devices = unwrapPayload(data)
      if (devices) {
        deviceStore.setDevices(devices as any)
        deviceStore.setConnectionState('READY')
      }
    })

    // connectionStatusUpdate fires when devices connect/disconnect — re-fetch the list
    on('connectionStatusUpdate', () => {
      socket.emit('getConnectedDevices')
    })

    on('getGroupsStatus', (data: unknown) => {
      const payload = unwrapPayload(data)
      if (payload) deviceStore.setGroups(payload as any)
    })

    on('groupDefinitions', (data: unknown) => {
      const payload = unwrapPayload(data)
      if (payload) deviceStore.setGroupDefinitions(payload as any)
    })

    // Config
    on('getDynamoConfigStatus', (data: unknown) => {
      const payload = unwrapPayload(data)
      if (payload && typeof payload === 'object') {
        const config = payload as Record<string, unknown>
        sessionStore.setDynamoConfig({
          emissionRate: Number(config.dataEmissionRate ?? config.emission_rate ?? 0),
          samplingRate: Number(config.samplingRate ?? config.sampling_rate ?? 1000),
          demoMode: Boolean(config.demoMode ?? config.demo_mode),
        })
      }
    })

    // Live data (high frequency)
    on('jsonData', (data: unknown) => {
      const frames = extractDeviceFrames(data)
      const pushFrame = useLiveDataStore.getState().pushFrame
      for (const frame of frames) pushFrame(frame)
    })

    on('simpleJsonData', (data: unknown) => {
      const frames = extractDeviceFrames(data)
      const pushFrame = useLiveDataStore.getState().pushFrame
      for (const frame of frames) pushFrame(frame)
    })

    // Capture lifecycle
    on('startCaptureStatus', (data: unknown) => {
      const resp = data as SocketResponse
      if (resp.status === 'success') {
        sessionStore.setSessionPhase('CAPTURING')
      } else {
        uiStore.addToast({ message: `Capture failed: ${resp.message}`, type: 'error' })
      }
    })

    on('stopCaptureStatus', (data: unknown) => {
      const resp = data as SocketResponse
      if (resp.status === 'success') {
        sessionStore.setSessionPhase('SUMMARY')
      }
    })

    on('cancelCaptureStatus', (data: unknown) => {
      const resp = data as SocketResponse
      if (resp.status === 'success') {
        sessionStore.setSessionPhase('IDLE')
        uiStore.addToast({ message: 'Capture cancelled', type: 'info' })
      }
    })

    // Tare
    on('tareStatus', (data: unknown) => {
      const resp = data as SocketResponse
      if (resp.status === 'success') {
        uiStore.addToast({ message: 'Tare complete', type: 'success' })
      } else {
        uiStore.addToast({ message: `Tare failed: ${resp.message}`, type: 'error' })
      }
    })

    on('tareAllStatus', (data: unknown) => {
      const resp = data as SocketResponse
      if (resp.status === 'success') {
        uiStore.addToast({ message: 'All devices tared', type: 'success' })
      }
    })

    // Device init
    on('initializationDevices', (data: unknown) => {
      const payload = unwrapPayload(data)
      if (payload) deviceStore.setDevices(payload as any)
    })

    on('initializationStatusUpdate', () => {})
    on('deviceSettingsList', () => {})
    on('deviceTypesList', (data: unknown) => {
      const payload = unwrapPayload(data)
      if (Array.isArray(payload)) {
        deviceStore.setDeviceTypes(payload as { deviceTypeId: string; name: string }[])
      }
    })

    // Group management
    on('groupUpdateStatus', (data: unknown) => {
      const resp = data as SocketResponse
      if (resp.status === 'success') {
        socket.emit('getGroups')
      } else {
        uiStore.addToast({ message: `Group update failed: ${resp.message}`, type: 'error' })
      }
    })

    // Models
    on('modelMetadata', (data: unknown) => {
      const payload = unwrapPayload(data)
      if (!Array.isArray(payload) || payload.length === 0) return
      const models = payload as ModelMetadata[]
      const deviceId = models[0].deviceId
      if (deviceId) deviceStore.setModelsForDevice(deviceId, models)
    })

    on('modelLoadStatus', (data: unknown) => {
      const resp = data as SocketResponse
      if (resp.status === 'success') {
        uiStore.addToast({ message: 'Model loaded', type: 'success' })
      } else {
        uiStore.addToast({ message: `Model load failed: ${resp.message}`, type: 'error' })
      }
    })

    on('modelActivationStatus', (data: unknown) => {
      const resp = data as SocketResponse
      if (resp.status === 'success') {
        uiStore.addToast({ message: 'Model activation updated', type: 'success' })
        for (const d of useDeviceStore.getState().devices) {
          socket.emit('getModelMetadata', { deviceId: d.axfId })
        }
      }
    })

    on('modelPackageStatus', (data: unknown) => {
      const resp = data as SocketResponse
      if (resp.status === 'success') {
        uiStore.addToast({ message: 'Model packaged successfully', type: 'success' })
        for (const d of useDeviceStore.getState().devices) {
          socket.emit('getModelMetadata', { deviceId: d.axfId })
        }
      } else {
        uiStore.addToast({ message: `Packaging failed: ${resp.message}`, type: 'error' })
      }
    })

    // Capture history (handled by page components directly)
    on('getCaptureMetricsStatus', () => {})
    on('getCaptureMetadataStatus', () => {})
    on('getCaptureResultsStatus', () => {})

    // Backend logs
    on('logMessage', (data: unknown) => {
      if (typeof data === 'string') uiStore.pushBackendLog(data)
      else if (typeof data === 'object' && data !== null) {
        uiStore.pushBackendLog(JSON.stringify(data))
      }
    })

    return () => {
      // Surgical cleanup: only remove the handlers we registered, not every
      // listener on the socket.
      for (const [event, handler] of handlers) {
        socket.off(event, handler)
      }
    }
  }, [])
}
