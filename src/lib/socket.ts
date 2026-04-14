import { io, Socket } from 'socket.io-client'

const SOCKET_URL = 'http://localhost:3000'

let socket: Socket | null = null

export function getSocket(): Socket {
  if (!socket) {
    socket = io(SOCKET_URL, {
      transports: ['websocket'],
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
    })
  }
  return socket
}

export function disconnectSocket(): void {
  socket?.disconnect()
  socket = null
}
