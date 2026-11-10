import { useEffect, useRef, useState } from 'react'

export type AsyncState<T> =
  | { status: 'loading' }
  | { status: 'error'; error: string }
  | { status: 'ready'; data: T }

/**
 * Load data for `key`; a new key aborts the previous request. The result is tagged with the key it
 * belongs to, so a stale response can never be shown for the current key (it reads as loading).
 */
export function useAsync<T>(key: string, load: (signal: AbortSignal) => Promise<T>): AsyncState<T> {
  const [result, setResult] = useState<{ key: string; state: AsyncState<T> } | null>(null)
  const loader = useRef(load)
  useEffect(() => {
    loader.current = load
  })

  useEffect(() => {
    const controller = new AbortController()
    loader.current(controller.signal).then(
      (data) => setResult({ key, state: { status: 'ready', data } }),
      (err: Error) => {
        if (!controller.signal.aborted) setResult({ key, state: { status: 'error', error: err.message } })
      },
    )
    return () => controller.abort()
  }, [key])

  return result?.key === key ? result.state : { status: 'loading' }
}
