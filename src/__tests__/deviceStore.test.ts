import { describe, it, expect, beforeEach } from 'vitest'
import { useDeviceStore } from '../stores/deviceStore'

describe('deviceStore', () => {
  beforeEach(() => {
    useDeviceStore.setState({
      connectionState: 'BACKEND_STARTING',
      devices: [],
      groups: [],
      groupDefinitions: [],
      models: [],
      selectedDeviceId: null,
    })
  })

  it('starts in BACKEND_STARTING state', () => {
    expect(useDeviceStore.getState().connectionState).toBe('BACKEND_STARTING')
  })

  it('sets connection state', () => {
    useDeviceStore.getState().setConnectionState('READY')
    expect(useDeviceStore.getState().connectionState).toBe('READY')
  })

  it('sets device list', () => {
    const devices = [
      { axfId: 'axf_001', name: 'Plate 1', deviceTypeId: '07', status: 'connected' },
    ]
    useDeviceStore.getState().setDevices(devices)
    expect(useDeviceStore.getState().devices).toHaveLength(1)
    expect(useDeviceStore.getState().devices[0].axfId).toBe('axf_001')
  })

  it('selects a device', () => {
    expect(useDeviceStore.getState().selectedDeviceId).toBeNull()
    useDeviceStore.getState().selectDevice('axf_001')
    expect(useDeviceStore.getState().selectedDeviceId).toBe('axf_001')
  })

  it('clears selected device', () => {
    useDeviceStore.getState().selectDevice('axf_001')
    useDeviceStore.getState().selectDevice(null)
    expect(useDeviceStore.getState().selectedDeviceId).toBeNull()
  })

  it('sets groups', () => {
    const groups = [
      { axfId: 'grp_001', name: 'Group 1', groupDefinitionId: 'def_01', devices: {} },
    ]
    useDeviceStore.getState().setGroups(groups)
    expect(useDeviceStore.getState().groups).toHaveLength(1)
  })
})
