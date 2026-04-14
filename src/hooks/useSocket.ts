import { useEffect } from 'react'
import { getSocket } from '../lib/socket'
import { extractDeviceFrames } from '../lib/frameParser'
import { useDeviceStore } from '../stores/deviceStore'
import { useSessionStore } from '../stores/sessionStore'
import { useLiveDataStore } from '../stores/liveDataStore'
import { useUiStore } from '../stores/uiStore'
import type { SocketResponse } from '../lib/types'

export function useSocket(): void {
  useEffect(() => {
    const socket = getSocket()
    const deviceStore = useDeviceStore.getState()
    const sessionStore = useSessionStore.getState()
    const uiStore = useUiStore.getState()

    // Connection lifecycle
    socket.on('connect', () => {
      deviceStore.setConnectionState('DISCOVERING_DEVICES')
      socket.emit('getConnectedDevices')
      socket.emit('getDynamoConfig')
      socket.emit('getGroups')
      socket.emit('getGroupDefinitions')
      socket.emit('getDeviceSettings')
      socket.emit('getDeviceTypes')
    })

    socket.on('disconnect', () => {
      deviceStore.setConnectionState('DISCONNECTED')
    })

    socket.on('connect_error', () => {
      deviceStore.setConnectionState('ERROR')
    })

    // Device events
    socket.on('connectedDeviceList', (data: unknown) => {
      const resp = data as SocketResponse
      if (resp.status === 'success' && resp.data) {
        deviceStore.setDevices(resp.data as any)
        deviceStore.setConnectionState('READY')
      }
    })

    socket.on('connectionStatusUpdate', (data: unknown) => {
      // Update specific device status - implementation depends on payload shape
    })

    socket.on('getGroupsStatus', (data: unknown) => {
      const resp = data as SocketResponse
      if (resp.status === 'success' && resp.data) {
        deviceStore.setGroups(resp.data as any)
      }
    })

    socket.on('groupDefinitions', (data: unknown) => {
      const resp = data as SocketResponse
      if (resp.status === 'success' && resp.data) {
        deviceStore.setGroupDefinitions(resp.data as any)
      }
    })

    // Config
    socket.on('getDynamoConfigStatus', (data: unknown) => {
      const resp = data as SocketResponse
      if (resp.status === 'success' && resp.data) {
        const config = resp.data as Record<string, unknown>
        sessionStore.setDynamoConfig({
          emissionRate: Number(config.dataEmissionRate ?? 0),
          samplingRate: Number(config.samplingRate ?? 1000),
          demoMode: Boolean(config.demoMode),
        })
      }
    })

    // Live data (high frequency)
    socket.on('jsonData', (data: unknown) => {
      const frames = extractDeviceFrames(data)
      const pushFrame = useLiveDataStore.getState().pushFrame
      for (const frame of frames) pushFrame(frame)
    })

    socket.on('simpleJsonData', (data: unknown) => {
      const frames = extractDeviceFrames(data)
      const pushFrame = useLiveDataStore.getState().pushFrame
      for (const frame of frames) pushFrame(frame)
    })

    // Capture lifecycle
    socket.on('startCaptureStatus', (data: unknown) => {
      const resp = data as SocketResponse
      if (resp.status === 'success') {
        sessionStore.setSessionPhase('CAPTURING')
      } else {
        uiStore.addToast({ message: `Capture failed: ${resp.message}`, type: 'error' })
      }
    })

    socket.on('stopCaptureStatus', (data: unknown) => {
      const resp = data as SocketResponse
      if (resp.status === 'success') {
        sessionStore.setSessionPhase('SUMMARY')
      }
    })

    socket.on('cancelCaptureStatus', (data: unknown) => {
      const resp = data as SocketResponse
      if (resp.status === 'success') {
        sessionStore.setSessionPhase('IDLE')
        uiStore.addToast({ message: 'Capture cancelled', type: 'info' })
      }
    })

    // Tare
    socket.on('tareStatus', (data: unknown) => {
      const resp = data as SocketResponse
      if (resp.status === 'success') {
        uiStore.addToast({ message: 'Tare complete', type: 'success' })
      } else {
        uiStore.addToast({ message: `Tare failed: ${resp.message}`, type: 'error' })
      }
    })

    socket.on('tareAllStatus', (data: unknown) => {
      const resp = data as SocketResponse
      if (resp.status === 'success') {
        uiStore.addToast({ message: 'All devices tared', type: 'success' })
      }
    })

    // Device init
    socket.on('initializationDevices', (data: unknown) => {
      const resp = data as SocketResponse
      if (resp.status === 'success' && resp.data) {
        deviceStore.setDevices(resp.data as any)
      }
    })

    socket.on('initializationStatusUpdate', (_data: unknown) => {})
    socket.on('deviceSettingsList', (_data: unknown) => {})
    socket.on('deviceTypesList', (_data: unknown) => {})

    // Group management
    socket.on('groupUpdateStatus', (data: unknown) => {
      const resp = data as SocketResponse
      if (resp.status === 'success') {
        socket.emit('getGroups')
      } else {
        uiStore.addToast({ message: `Group update failed: ${resp.message}`, type: 'error' })
      }
    })

    // Models
    socket.on('modelMetadata', (data: unknown) => {
      const resp = data as SocketResponse
      if (resp.status === 'success' && resp.data) {
        deviceStore.setModels(resp.data as any)
      }
    })

    socket.on('modelLoadStatus', (data: unknown) => {
      const resp = data as SocketResponse
      if (resp.status === 'success') {
        uiStore.addToast({ message: 'Model loaded', type: 'success' })
      } else {
        uiStore.addToast({ message: `Model load failed: ${resp.message}`, type: 'error' })
      }
    })

    socket.on('modelActivationStatus', (data: unknown) => {
      const resp = data as SocketResponse
      if (resp.status === 'success') {
        uiStore.addToast({ message: 'Model activation updated', type: 'success' })
      }
    })

    socket.on('modelPackageStatus', (data: unknown) => {
      const resp = data as SocketResponse
      if (resp.status === 'success') {
        uiStore.addToast({ message: 'Model packaged successfully', type: 'success' })
      } else {
        uiStore.addToast({ message: `Packaging failed: ${resp.message}`, type: 'error' })
      }
    })

    // Capture history (handled by page components directly)
    socket.on('getCaptureMetricsStatus', () => {})
    socket.on('getCaptureMetadataStatus', () => {})
    socket.on('getCaptureResultsStatus', () => {})

    // Backend logs
    socket.on('logMessage', (data: unknown) => {
      if (typeof data === 'string') uiStore.pushBackendLog(data)
      else if (typeof data === 'object' && data !== null) {
        uiStore.pushBackendLog(JSON.stringify(data))
      }
    })

    return () => {
      socket.removeAllListeners()
    }
  }, [])
}
