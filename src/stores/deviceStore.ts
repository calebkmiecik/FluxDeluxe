import { create } from 'zustand'
import type { ConnectionState, Device, DeviceGroup } from '../lib/types'

export interface DeviceType {
  deviceTypeId: string
  name: string
}

/**
 * Model metadata as delivered by the backend. Field names are camelCase
 * because the backend runs `convert_to_camel(data)` before emitting
 * (see fluxdeluxe/DynamoPy/app/flux_bridge/flux_bridge.py :: emit).
 */
export interface ModelMetadata {
  modelId: string
  deviceId: string
  packageDate: number
  modelActive: boolean
  location: 'local' | 'remote' | 'both'
  // Plus other fields we don't use directly
  [key: string]: unknown
}

interface DeviceStoreState {
  connectionState: ConnectionState
  devices: Device[]
  groups: DeviceGroup[]
  groupDefinitions: unknown[]
  modelsByDevice: Record<string, ModelMetadata[]>
  deviceTypes: DeviceType[]
  selectedDeviceId: string | null
  setConnectionState: (state: ConnectionState) => void
  setDevices: (devices: Device[]) => void
  setGroups: (groups: DeviceGroup[]) => void
  setGroupDefinitions: (defs: unknown[]) => void
  setModelsForDevice: (deviceId: string, models: ModelMetadata[]) => void
  setDeviceTypes: (types: DeviceType[]) => void
  selectDevice: (id: string | null) => void
}

export const useDeviceStore = create<DeviceStoreState>()((set) => ({
  connectionState: 'BACKEND_STARTING',
  devices: [],
  groups: [],
  groupDefinitions: [],
  modelsByDevice: {},
  deviceTypes: [],
  selectedDeviceId: null,
  setConnectionState: (connectionState) => set({ connectionState }),
  setDevices: (devices) => set((state) => {
    // Auto-select behavior:
    // - If nothing is selected and devices arrive, pick the first one.
    // - If the currently selected device is no longer in the list, pick the
    //   first available (or null if the list is empty).
    const stillPresent = state.selectedDeviceId
      && devices.some((d) => d.axfId === state.selectedDeviceId)
    let selectedDeviceId = state.selectedDeviceId
    if (!stillPresent) {
      selectedDeviceId = devices.length > 0 ? devices[0].axfId : null
    }
    return { devices, selectedDeviceId }
  }),
  setGroups: (groups) => set({ groups }),
  setGroupDefinitions: (groupDefinitions) => set({ groupDefinitions }),
  setModelsForDevice: (deviceId, models) => set((state) => ({
    modelsByDevice: { ...state.modelsByDevice, [deviceId]: models },
  })),
  setDeviceTypes: (deviceTypes) => set({ deviceTypes }),
  selectDevice: (selectedDeviceId) => set({ selectedDeviceId }),
}))
