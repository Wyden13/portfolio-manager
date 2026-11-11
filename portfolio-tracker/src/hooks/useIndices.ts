import { useEffect, useState } from 'react'
import { fetchHistory } from '../api/client'
import { INDICES, type IndexQuote } from '../demo/market'

export interface IndexRow extends IndexQuote {
  /** True while (or when) the figure is the sample one: no real quote could be fetched. */
  sample: boolean
}

const SAMPLE: IndexRow[] = INDICES.map((i) => ({ ...i, sample: true }))
const TTL_MS = 5 * 60_000

let cache: { at: number; rows: Promise<IndexRow[]> } | null = null

/** Last close and change vs the close before, from the history endpoint; sample figures where that fails. */
async function load(): Promise<IndexRow[]> {
  return Promise.all(INDICES.map(async (i): Promise<IndexRow> => {
    if (!i.yahoo) return { ...i, sample: true }
    try {
      const { candles } = await fetchHistory(i.yahoo, '1M', '1d')
      const [prev, last] = candles.slice(-2)
      if (!prev || !last || !prev.close) return { ...i, sample: true }
      return { ...i, last: last.close, change: ((last.close - prev.close) / prev.close) * 100, absolute: false, sample: false }
    } catch {
      return { ...i, sample: true }
    }
  }))
}

/** Index, FX and commodity quotes for the tape and the News page, shared and refreshed every 5 minutes. */
export function useIndices(): IndexRow[] {
  const [rows, setRows] = useState<IndexRow[]>(SAMPLE)
  useEffect(() => {
    let live = true
    if (!cache || Date.now() - cache.at > TTL_MS) cache = { at: Date.now(), rows: load() }
    void cache.rows.then((r) => { if (live) setRows(r) })
    return () => { live = false }
  }, [])
  return rows
}
