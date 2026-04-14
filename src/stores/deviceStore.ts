import { create } from 'zustand'
import type { ConnectionState, Device, DeviceGroup } from '../lib/types'

interface DeviceStoreState {
  connectionState: ConnectionState
  devices: Device[]
  groups: DeviceGroup[]
  groupDefinitions: unknown[]
  models: unknown[]
  selectedDeviceId: string | null
  setConnectionState: (state: ConnectionState) => void
  setDevices: (devices: Device[]) => void
  setGroups: (groups: DeviceGroup[]) => void
  setGroupDefinitions: (defs: unknown[]) => void
  setModels: (models: unknown[]) => void
  selectDevice: (id: string | null) => void
}

export const useDeviceStore = create<DeviceStoreState>()((set) => ({
  connectionState: 'BACKEND_STARTING',
  devices: [],
  groups: [],
  groupDefinitions: [],
  models: [],
  selectedDeviceId: null,
  setConnectionState: (connectionState) => set({ connectionState }),
  setDevices: (devices) => set({ devices }),
  setGroups: (groups) => set({ groups }),
  setGroupDefinitions: (groupDefinitions) => set({ groupDefinitions }),
  setModels: (models) => set({ models }),
  selectDevice: (selectedDeviceId) => set({ selectedDeviceId }),
}))
