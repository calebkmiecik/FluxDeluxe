import { useRef, useEffect } from 'react'

export function useAnimationFrame(callback: (dt: number) => void): void {
  const callbackRef = useRef(callback)
  callbackRef.current = callback

  useEffect(() => {
    let lastTime = performance.now()
    let frameId: number

    function loop(time: number) {
      const dt = time - lastTime
      lastTime = time
      callbackRef.current(dt)
      frameId = requestAnimationFrame(loop)
    }

    frameId = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(frameId)
  }, [])
}
