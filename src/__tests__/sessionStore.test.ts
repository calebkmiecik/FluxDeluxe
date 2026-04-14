import { describe, it, expect, beforeEach } from 'vitest'
import { useSessionStore } from '../stores/sessionStore'

describe('sessionStore', () => {
  beforeEach(() => {
    useSessionStore.setState({
      sessionPhase: 'IDLE',
      activeCapture: null,
      dynamoConfig: { emissionRate: 0, samplingRate: 1000 },
    })
  })

  it('starts in IDLE phase', () => {
    expect(useSessionStore.getState().sessionPhase).toBe('IDLE')
  })

  it('transitions session phase', () => {
    useSessionStore.getState().setSessionPhase('CAPTURING')
    expect(useSessionStore.getState().sessionPhase).toBe('CAPTURING')
  })

  it('transitions through multiple phases', () => {
    const phases = ['WARMUP', 'TARE', 'ARMED', 'STABLE', 'CAPTURING', 'SUMMARY', 'IDLE'] as const
    for (const phase of phases) {
      useSessionStore.getState().setSessionPhase(phase)
      expect(useSessionStore.getState().sessionPhase).toBe(phase)
    }
  })

  it('sets dynamo config (partial merge)', () => {
    useSessionStore.getState().setDynamoConfig({ emissionRate: 100 })
    const config = useSessionStore.getState().dynamoConfig
    expect(config.emissionRate).toBe(100)
    expect(config.samplingRate).toBe(1000) // preserved
  })

  it('sets dynamo config with demoMode', () => {
    useSessionStore.getState().setDynamoConfig({ demoMode: true, samplingRate: 500 })
    const config = useSessionStore.getState().dynamoConfig
    expect(config.demoMode).toBe(true)
    expect(config.samplingRate).toBe(500)
    expect(config.emissionRate).toBe(0) // preserved
  })

  it('sets active capture', () => {
    const capture = { startTime: Date.now(), athleteId: 'athlete_1', tags: ['sprint'] }
    useSessionStore.getState().setActiveCapture(capture)
    expect(useSessionStore.getState().activeCapture).toEqual(capture)
  })

  it('clears active capture', () => {
    useSessionStore.getState().setActiveCapture({ startTime: 1000 })
    useSessionStore.getState().setActiveCapture(null)
    expect(useSessionStore.getState().activeCapture).toBeNull()
  })
})
