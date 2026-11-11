/**
 * SAMPLE DATA. There is no news source behind InvestIQ yet; these headlines stand in so the News
 * page and panels can be laid out. `daysAgo` keeps them relative to today.
 */

export interface Story {
  daysAgo: number
  time: string
  headline: string
  source: string
  /** Yahoo symbol the story is about. */
  symbol: string
}

const S = (daysAgo: number, time: string, headline: string, source: string, symbol: string): Story =>
  ({ daysAgo, time, headline, source, symbol })

/** Stories about individual companies and funds; filtered to what you hold. */
export const COMPANY_NEWS: Story[] = [
  S(0, '11:02', 'Shopify climbs after merchant volume update', 'Market Wire', 'SHOP.TO'),
  S(0, '10:41', 'BCE slides as analysts revisit dividend coverage', 'The Ledger', 'BCE.TO'),
  S(0, '09:58', 'Big Six bank stocks drift lower ahead of Q4 earnings', 'The Ledger', 'RY.TO'),
  S(0, '09:30', 'Chipmakers extend rally as data-centre demand holds', 'Market Wire', 'NVDA'),
  S(0, '08:15', 'Rate decision preview: what a cut would mean for bond ETFs', 'The Ledger', 'ZAG.TO'),
  S(0, '07:40', 'Analysts lift Shopify price targets ahead of holiday quarter', 'The Ledger', 'SHOP.TO'),
  S(0, '07:05', 'Apple suppliers flag steady holiday orders', 'Market Wire', 'AAPL'),
  S(1, '16:20', 'Enbridge reaffirms 2026 guidance on investor call', 'Market Wire', 'ENB.TO'),
  S(1, '14:05', 'Canadian tech leads TSX gains for a third session', 'Market Wire', 'SHOP.TO'),
  S(1, '11:30', 'TD sets date for fourth-quarter results', 'The Ledger', 'TD.TO'),
  S(1, '09:12', 'All-in-one ETFs keep drawing first-time investors', 'Market Wire', 'XEQT.TO'),
  S(1, '08:50', 'Microsoft expands data-centre capacity in Canada', 'The Ledger', 'MSFT'),
  S(4, '15:48', 'S&P 500 ETFs see record weekly inflows', 'The Ledger', 'VFV.TO'),
  S(4, '10:02', 'Pipeline operators weigh dividend growth against capital plans', 'The Ledger', 'ENB.TO'),
  S(4, '08:44', 'iShares trims fees on core bond ETFs', 'Market Wire', 'XIU.TO'),
  S(4, '08:10', 'Railways report steady grain volumes into the fall', 'Market Wire', 'CNR.TO'),
  S(5, '13:15', 'BCE cuts capital spending plan for 2026', 'The Ledger', 'BCE.TO'),
  S(5, '11:40', 'Amazon widens same-day delivery in Ontario', 'Market Wire', 'AMZN'),
  S(6, '07:40', 'Shopify Q3: revenue and gross merchandise volume, by the numbers', 'Market Wire', 'SHOP.TO'),
  S(7, '09:00', 'What to watch in Shopify earnings this week', 'The Ledger', 'SHOP.TO'),
  S(13, '10:30', 'Options traders price a large earnings move in SHOP', 'Market Wire', 'SHOP.TO'),
  S(20, '14:20', 'Software stocks rebound as rate expectations ease', 'The Ledger', 'SHOP.TO'),
]

/** Market-wide stories. */
export const MARKET_NEWS: Story[] = [
  S(0, '11:20', 'TSX edges higher as tech offsets energy weakness', 'Market Wire', 'XIU.TO'),
  S(0, '10:55', 'Oil slips on rising inventories', 'The Ledger', 'CNQ.TO'),
  S(0, '10:12', 'Lightspeed jumps after raising annual outlook', 'Market Wire', 'LSPD.TO'),
  S(0, '09:45', 'Gold miners firm as yields ease', 'The Ledger', 'ABX.TO'),
  S(0, '08:30', 'Loonie little changed ahead of US inflation data', 'Market Wire', 'CAD=X'),
  S(1, '16:05', 'Wall Street closes mixed in light trading', 'The Ledger', 'VOO'),
  S(1, '13:40', 'Telecom stocks under pressure on spectrum costs', 'Market Wire', 'T.TO'),
]
