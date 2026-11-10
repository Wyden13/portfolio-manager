import { snapTradePortalUrl, type SnapTradePortalOptions } from '../api/client'

/** Tells other open InvestIQ windows (the one that opened the SnapTrade portal) that a link finished. */
export const LINK_CHANNEL = 'investiq-connections'
const POPUP_FEATURES = 'popup,width=520,height=760'

function waitUntilClosed(popup: Window): Promise<void> {
  return new Promise((resolve) => {
    const timer = window.setInterval(() => {
      if (popup.closed) {
        window.clearInterval(timer)
        resolve()
      }
    }, 500)
  })
}

/**
 * Open SnapTrade's portal in a popup and resolve once it closes. Call it straight from a click: the
 * window opens before the portal URL arrives, so popup blockers allow it. If it is blocked anyway
 * the whole page goes to the portal, which comes back to #/connections?linked=snaptrade.
 */
export async function openSnapTradePortal(opts: SnapTradePortalOptions): Promise<'closed' | 'redirected'> {
  const popup = window.open('about:blank', 'snaptrade-portal', POPUP_FEATURES)
  let url: string
  try {
    url = await snapTradePortalUrl(opts)
  } catch (e) {
    popup?.close()
    throw e
  }
  if (!popup || popup.closed) {
    window.location.assign(url)
    return 'redirected'
  }
  popup.location.href = url
  await waitUntilClosed(popup)
  return 'closed'
}
