import { useMemo } from 'react'
import { fetchProfiles } from '../api/client'
import type { Profiles } from '../lib/holdings'
import type { PortfolioSnapshot } from '../types'
import { useAsync } from './useAsync'

const NONE: Profiles = {}

/** Company profiles for the held symbols, fetched again only when the set of symbols changes. */
export function useProfiles(snapshot: PortfolioSnapshot | null): Profiles {
  const key = useMemo(() => [...new Set(snapshot?.positions.map((p) => p.symbol) ?? [])].sort().join(','), [snapshot])
  // Profiles fill in names and sectors; without them the tables still work, so failures stay quiet.
  const state = useAsync(`profiles:${key}`, (signal) => (key ? fetchProfiles(signal) : Promise.resolve(NONE)))
  return state.status === 'ready' ? state.data : NONE
}
