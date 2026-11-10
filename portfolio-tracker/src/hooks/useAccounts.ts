import { createContext, useCallback, useContext, useMemo, useState } from 'react'
import { fetchAccounts } from '../api/client'
import type { AccountLabel } from '../lib/aggregate'
import type { LinkedAccount } from '../types'
import { useAsync } from './useAsync'

export const accountName = (a: LinkedAccount) => `${a.institution} · ${a.account_type} ${a.account_number}`

export interface Accounts {
  list: LinkedAccount[]
  label: AccountLabel
  get: (accountId: number) => LinkedAccount | undefined
  /** Load the list again (after an institution is connected, synced or disconnected). */
  reload: () => void
}

/** Linked accounts, loaded once; labels fall back to the id until (or if) they arrive. */
export function useAccountsLoader(attempt: number): Accounts {
  const [version, setVersion] = useState(0)
  const reload = useCallback(() => setVersion((v) => v + 1), [])
  const state = useAsync(`accounts:${attempt}:${version}`, fetchAccounts)
  return useMemo(() => {
    const list = state.status === 'ready' ? state.data : []
    const byId = new Map(list.map((a) => [a.id, a]))
    return {
      list,
      label: (id: number) => { const a = byId.get(id); return a ? accountName(a) : `Account ${id}` },
      get: (id: number) => byId.get(id),
      reload,
    }
  }, [state, reload])
}

export const AccountsContext = createContext<Accounts>({
  list: [], label: (id) => `Account ${id}`, get: () => undefined, reload: () => {},
})

export const useAccounts = () => useContext(AccountsContext)
