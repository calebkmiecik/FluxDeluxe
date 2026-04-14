import { create } from 'zustand'
import type { SessionPhase } from '../lib/types'

interface DynamoConfig {
  emissionRate: number
  samplingRate: number
  demoMode?: boolean
}

interface SessionStoreState {
  sessionPhase: SessionPhase
  activeCapture: { startTime?: number; athleteId?: string; tags?: string[] } | null
  dynamoConfig: DynamoConfig
  setSessionPhase: (phase: SessionPhase) => void
  setActiveCapture: (capture: SessionStoreState['activeCapture']) => void
  setDynamoConfig: (config: Partial<DynamoConfig>) => void
}

export const useSessionStore = create<SessionStoreState>()((set) => ({
  sessionPhase: 'IDLE',
  activeCapture: null,
  dynamoConfig: { emissionRate: 0, samplingRate: 1000 },
  setSessionPhase: (sessionPhase) => set({ sessionPhase }),
  setActiveCapture: (activeCapture) => set({ activeCapture }),
  setDynamoConfig: (config) => set((s) => ({ dynamoConfig: { ...s.dynamoConfig, ...config } })),
}))
