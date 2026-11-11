/**
 * SAMPLE DATA. The backend has no market-wide endpoints yet (indices, sectors, movers, screener
 * fundamentals), so these figures stand in. Every panel that shows them carries a "Sample" tag.
 */

export interface IndexQuote {
  /** Yahoo symbol to fetch the real figure with, when there is one. */
  yahoo: string | null
  /** Short label for the ticker tape; null keeps it off the tape. */
  tape: string | null
  name: string
  last: number
  /** Percent, or for yields an absolute change in points (`absolute`). */
  change: number
  absolute?: boolean
  digits: number
}

export const INDICES: IndexQuote[] = [
  { yahoo: '^GSPTSE', tape: 'S&P/TSX', name: 'S&P/TSX Composite', last: 25418.62, change: 0.41, digits: 2 },
  { yahoo: null, tape: null, name: 'S&P/TSX 60', last: 1512.40, change: 0.39, digits: 2 },
  { yahoo: '^GSPC', tape: 'S&P 500', name: 'S&P 500', last: 6102.35, change: 0.28, digits: 2 },
  { yahoo: '^IXIC', tape: 'Nasdaq', name: 'Nasdaq Composite', last: 19884.10, change: 0.62, digits: 2 },
  { yahoo: '^DJI', tape: 'Dow', name: 'Dow Jones', last: 43910.25, change: 0.12, digits: 2 },
  { yahoo: 'CAD=X', tape: 'USD/CAD', name: 'USD/CAD', last: 1.3921, change: -0.11, digits: 4 },
  { yahoo: 'CL=F', tape: 'WTI', name: 'WTI crude', last: 68.14, change: -1.08, digits: 2 },
  { yahoo: 'GC=F', tape: 'Gold', name: 'Gold', last: 2684.40, change: -0.35, digits: 2 },
  { yahoo: null, tape: 'CA 10Y', name: 'Canada 10-year yield', last: 3.142, change: -0.021, absolute: true, digits: 3 },
]

export type Exchange = 'TSX' | 'NYSE' | 'Nasdaq'

export interface Listing {
  symbol: string
  name: string
  exchange: Exchange
  sector: string
  /** Market cap in the listing's currency. */
  cap: number
  pe: number | null
  fpe: number | null
  /** Dividend yield, percent. */
  yield: number
  price: number
  change: number
  volume: number
}

const L = (symbol: string, name: string, exchange: Exchange, sector: string, cap: number, pe: number | null,
  fpe: number | null, yld: number, price: number, change: number, volume: number): Listing =>
  ({ symbol, name, exchange, sector, cap: cap * 1e9, pe, fpe, yield: yld, price, change, volume: volume * 1e6 })

export const TSX: Listing[] = [
  L('RY.TO', 'Royal Bank of Canada', 'TSX', 'Financials', 267.4, 14.8, 13.1, 3.3, 189.30, -0.42, 3.9),
  L('TD.TO', 'Toronto-Dominion Bank', 'TSX', 'Financials', 142.6, 16.2, 10.4, 5.1, 81.63, -0.61, 6.7),
  L('BMO.TO', 'Bank of Montreal', 'TSX', 'Financials', 98.1, 14.1, 11.6, 4.6, 134.20, 0.18, 2.2),
  L('BNS.TO', 'Bank of Nova Scotia', 'TSX', 'Financials', 94.6, 12.4, 10.6, 5.6, 76.20, -1.12, 4.4),
  L('CM.TO', 'Canadian Imperial Bank of Commerce', 'TSX', 'Financials', 84.2, 12.1, 11.2, 4.2, 89.44, 0.04, 3.0),
  L('MFC.TO', 'Manulife Financial Corp.', 'TSX', 'Financials', 77.5, 15.3, 10.8, 3.9, 44.12, 0.52, 5.2),
  L('NA.TO', 'National Bank of Canada', 'TSX', 'Financials', 51.3, 13.0, 12.1, 3.5, 131.40, -0.24, 1.0),
  L('SLF.TO', 'Sun Life Financial Inc.', 'TSX', 'Financials', 47.0, 13.6, 11.4, 4.3, 80.65, 0.29, 1.1),
  L('POW.TO', 'Power Corporation of Canada', 'TSX', 'Financials', 29.8, 11.8, 10.9, 5.1, 45.02, 0.36, 1.6),
  L('ENB.TO', 'Enbridge Inc.', 'TSX', 'Energy', 133.0, 19.6, 19.9, 6.2, 61.05, -0.88, 5.9),
  L('CNQ.TO', 'Canadian Natural Resources Ltd.', 'TSX', 'Energy', 95.2, 12.9, 13.4, 4.9, 44.80, -1.34, 8.1),
  L('SU.TO', 'Suncor Energy Inc.', 'TSX', 'Energy', 68.4, 9.1, 11.0, 4.3, 54.35, 0.22, 4.6),
  L('TRP.TO', 'TC Energy Corp.', 'TSX', 'Energy', 68.9, 15.1, 16.6, 6.4, 66.32, -0.47, 2.8),
  L('PPL.TO', 'Pembina Pipeline Corp.', 'TSX', 'Energy', 33.6, 17.3, 17.0, 4.8, 57.92, -0.21, 1.8),
  L('CVE.TO', 'Cenovus Energy Inc.', 'TSX', 'Energy', 38.9, 11.4, 12.2, 3.1, 21.15, -1.05, 6.2),
  L('IMO.TO', 'Imperial Oil Ltd.', 'TSX', 'Energy', 52.0, 11.8, 12.9, 2.4, 102.40, -0.80, 0.9),
  L('SHOP.TO', 'Shopify Inc.', 'TSX', 'Technology', 205.6, 78.4, 71.0, 0, 158.42, 3.84, 4.8),
  L('CSU.TO', 'Constellation Software Inc.', 'TSX', 'Technology', 95.6, 98.2, 39.5, 0.1, 4512.00, 1.06, 0.1),
  L('OTEX.TO', 'Open Text Corp.', 'TSX', 'Technology', 10.9, 12.6, 7.9, 3.6, 41.10, 0.48, 0.7),
  L('CLS.TO', 'Celestica Inc.', 'TSX', 'Technology', 21.2, 33.0, 24.1, 0, 182.40, 2.71, 1.2),
  L('LSPD.TO', 'Lightspeed Commerce Inc.', 'TSX', 'Technology', 3.7, null, 38.4, 0, 24.18, 6.42, 2.1),
  L('KXS.TO', 'Kinaxis Inc.', 'TSX', 'Technology', 4.9, 92.0, 41.2, 0, 171.30, 1.98, 0.2),
  L('CNR.TO', 'Canadian National Railway', 'TSX', 'Industrials', 98.7, 19.1, 17.2, 2.4, 156.20, 0.62, 1.4),
  L('CP.TO', 'Canadian Pacific Kansas City', 'TSX', 'Industrials', 103.0, 27.4, 22.8, 0.7, 110.65, 0.31, 1.5),
  L('WCN.TO', 'Waste Connections Inc.', 'TSX', 'Industrials', 63.0, 48.1, 32.0, 0.7, 255.10, -0.08, 0.3),
  L('ABX.TO', 'Barrick Gold Corp.', 'TSX', 'Materials', 45.8, 18.4, 11.9, 2.2, 26.10, 2.41, 9.6),
  L('NTR.TO', 'Nutrien Ltd.', 'TSX', 'Materials', 34.3, 31.6, 15.5, 4.4, 69.80, -0.27, 1.3),
  L('FNV.TO', 'Franco-Nevada Corp.', 'TSX', 'Materials', 35.6, 41.0, 37.2, 1.1, 186.20, 1.12, 0.6),
  L('WPM.TO', 'Wheaton Precious Metals', 'TSX', 'Materials', 40.2, 45.6, 36.1, 0.9, 88.75, 2.20, 1.4),
  L('BCE.TO', 'BCE Inc.', 'TSX', 'Telecom', 31.1, 17.9, 12.8, 11.7, 34.10, -2.36, 7.3),
  L('T.TO', 'TELUS Corp.', 'TSX', 'Telecom', 30.4, 19.2, 18.4, 7.9, 20.18, -0.55, 5.1),
  L('FTS.TO', 'Fortis Inc.', 'TSX', 'Utilities', 31.9, 19.4, 18.7, 4.1, 63.80, 0.12, 1.3),
  L('ATD.TO', 'Alimentation Couche-Tard', 'TSX', 'Consumer', 73.0, 18.6, 17.5, 1.0, 76.94, 0.84, 1.9),
  L('L.TO', 'Loblaw Companies Ltd.', 'TSX', 'Consumer', 55.4, 26.2, 22.0, 1.2, 182.30, -0.15, 0.5),
  L('DOL.TO', 'Dollarama Inc.', 'TSX', 'Consumer', 41.0, 38.4, 32.1, 0.3, 146.40, 0.06, 0.6),
]

export const SP500: Listing[] = [
  L('AAPL', 'Apple Inc.', 'Nasdaq', 'Technology', 3420, 33.1, 30.2, 0.4, 226.80, 0.54, 48.2),
  L('MSFT', 'Microsoft Corp.', 'Nasdaq', 'Technology', 3150, 35.4, 31.0, 0.7, 423.60, 0.31, 19.4),
  L('NVDA', 'NVIDIA Corp.', 'Nasdaq', 'Technology', 3480, 55.2, 33.8, 0, 142.18, 1.92, 210.5),
  L('AVGO', 'Broadcom Inc.', 'Nasdaq', 'Technology', 820, 38.0, 29.1, 1.3, 175.40, 1.10, 22.0),
  L('GOOGL', 'Alphabet Inc. Class A', 'Nasdaq', 'Communication', 2130, 23.4, 20.8, 0.5, 173.20, -0.36, 24.1),
  L('META', 'Meta Platforms Inc.', 'Nasdaq', 'Communication', 1460, 27.5, 23.4, 0.3, 578.10, 0.82, 11.3),
  L('AMZN', 'Amazon.com Inc.', 'Nasdaq', 'Consumer', 2090, 44.3, 34.6, 0, 199.50, 0.67, 37.8),
  L('TSLA', 'Tesla Inc.', 'Nasdaq', 'Consumer', 1050, 92.0, 104.0, 0, 328.40, 3.05, 98.1),
  L('HD', 'Home Depot Inc.', 'NYSE', 'Consumer', 410, 27.0, 25.6, 2.2, 412.30, -0.42, 3.1),
  L('JPM', 'JPMorgan Chase & Co.', 'NYSE', 'Financials', 690, 13.4, 13.9, 2.0, 242.10, 0.58, 9.6),
  L('V', 'Visa Inc.', 'NYSE', 'Financials', 590, 31.2, 27.4, 0.7, 305.20, 0.15, 6.4),
  L('BRK-B', 'Berkshire Hathaway Inc. Class B', 'NYSE', 'Financials', 1010, 13.7, 22.5, 0, 470.80, -0.12, 3.8),
  L('XOM', 'Exxon Mobil Corp.', 'NYSE', 'Energy', 520, 14.9, 13.7, 3.3, 118.60, -0.94, 14.2),
  L('CVX', 'Chevron Corp.', 'NYSE', 'Energy', 290, 16.2, 13.0, 4.1, 159.40, -0.71, 7.7),
  L('LLY', 'Eli Lilly and Co.', 'NYSE', 'Health care', 760, 83.0, 39.4, 0.7, 801.90, -1.40, 4.2),
  L('UNH', 'UnitedHealth Group Inc.', 'NYSE', 'Health care', 550, 37.1, 19.8, 1.4, 596.70, -0.65, 3.9),
  L('JNJ', 'Johnson & Johnson', 'NYSE', 'Health care', 375, 25.9, 15.3, 3.2, 155.80, 0.20, 6.8),
  L('PG', 'Procter & Gamble Co.', 'NYSE', 'Consumer staples', 400, 28.4, 24.5, 2.4, 170.40, 0.09, 6.0),
  L('KO', 'Coca-Cola Co.', 'NYSE', 'Consumer staples', 275, 25.6, 21.8, 3.1, 63.90, -0.22, 12.4),
  L('CAT', 'Caterpillar Inc.', 'NYSE', 'Industrials', 190, 17.8, 18.1, 1.4, 391.60, 1.24, 2.4),
  L('GE', 'GE Aerospace', 'NYSE', 'Industrials', 195, 33.5, 35.6, 0.6, 179.20, 0.48, 5.0),
  L('LIN', 'Linde plc', 'Nasdaq', 'Materials', 215, 33.9, 28.0, 1.3, 456.10, 0.33, 1.8),
  L('NEE', 'NextEra Energy Inc.', 'NYSE', 'Utilities', 160, 22.0, 20.2, 2.6, 77.80, -0.38, 9.1),
  L('PLD', 'Prologis Inc.', 'NYSE', 'Real estate', 105, 34.2, 33.5, 3.3, 113.90, -0.18, 3.6),
]

/** Every listing we have sample figures for, by symbol. */
export const LISTINGS: Map<string, Listing> = new Map([...TSX, ...SP500].map((l) => [l.symbol, l]))
