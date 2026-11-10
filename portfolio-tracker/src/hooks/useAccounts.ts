import { createContext, useContext, useMemo } from 'react'
import { fetchAccounts } from '../api/client'
import type { AccountLabel } from '../lib/aggregate'
import type { LinkedAccount } from '../types'
import { useAsync } from './useAsync'

export const accountName = (a: LinkedAccount) => `${a.institution} · ${a.account_type} ${a.account_number}`

export interface Accounts {
  list: LinkedAccount[]
  label: AccountLabel
  /** The account itself, when known. */
  get: (accountId: number) => LinkedAccount | undefined
}

/** Linked accounts, loaded once; labels fall back to the id until (or if) they arrive. */
export function useAccountsLoader(attempt: number): Accounts {
  const state = useAsync(`accounts:${attempt}`, fetchAccounts)
  return useMemo(() => {
    const list = state.status === 'ready' ? state.data : []
    const byId = new Map(list.map((a) => [a.id, a]))
    return {
      list,
      label: (id: number) => { const a = byId.get(id); return a ? accountName(a) : `Account ${id}` },
      get: (id: number) => byId.get(id),
    }
  }, [state])
}

export const AccountsContext = createContext<Accounts>({ list: [], label: (id) => `Account ${id}`, get: () => undefined })

export const useAccounts = () => useContext(AccountsContext)
