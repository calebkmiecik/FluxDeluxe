// Device frame from DynamoPy live data stream
export interface DeviceFrame {
  id: string
  fx: number
  fy: number
  fz: number
  time?: number
  avgTemperatureF?: number
  cop: { x: number; y: number }
  moments: { x: number; y: number; z: number }
  groupId?: string
}

// Connected device info
export interface Device {
  axfId: string
  name: string
  deviceTypeId: string
  status: string
  firmwareVersion?: string
  temperature?: number
}

// Device group (mound setup)
export interface DeviceGroup {
  axfId: string
  name: string
  groupDefinitionId: string
  devices: Record<string, string> // position -> deviceId
}

// Socket.IO response envelope
export interface SocketResponse<T = unknown> {
  status: 'success' | 'error'
  message: string
  data?: T
  errorDetails?: string
}

// Session phases
export type ConnectionState =
  | 'BACKEND_STARTING'
  | 'SOCKET_CONNECTING'
  | 'DISCOVERING_DEVICES'
  | 'READY'
  | 'DISCONNECTED'
  | 'ERROR'

export type SessionPhase =
  | 'IDLE'
  | 'WARMUP'
  | 'TARE'
  | 'ARMED'
  | 'STABLE'
  | 'CAPTURING'
  | 'SUMMARY'

// Plate geometry constants
export const PLATE_DIMENSIONS: Record<string, { width: number; height: number }> = {
  '06': { width: 353.2, height: 404.0 },
  '07': { width: 353.3, height: 607.3 },
  '08': { width: 658.1, height: 607.3 },
  '11': { width: 353.3, height: 607.3 },
  '12': { width: 658.1, height: 607.3 },
}

// Grid dimensions per device type
export const GRID_DIMS: Record<string, { rows: number; cols: number }> = {
  '06': { rows: 3, cols: 3 },
  '07': { rows: 5, cols: 3 },
  '08': { rows: 5, cols: 5 },
  '11': { rows: 5, cols: 3 },
  '12': { rows: 5, cols: 5 },
}

// Color bins for cell grading
export const COLOR_BIN_MULTIPLIERS = {
  green: 0.5,
  light_green: 1.0,
  yellow: 1.5,
  orange: 2.5,
} as const

export const COLOR_BIN_RGBA: Record<string, [number, number, number, number]> = {
  green: [0, 200, 0, 180],
  light_green: [144, 238, 144, 180],
  yellow: [255, 255, 0, 180],
  orange: [255, 165, 0, 180],
  red: [255, 0, 0, 180],
}

// Passing thresholds (N) by device type
export const THRESHOLDS_DB_N: Record<string, number> = {
  '06': 5.0, '07': 6.0, '08': 8.0, '11': 6.0, '12': 8.0,
}

export const THRESHOLDS_BW_PCT: Record<string, number> = {
  '06': 0.010, '07': 0.015, '08': 0.020, '11': 0.015, '12': 0.020,
}
