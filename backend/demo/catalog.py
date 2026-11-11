"""Instruments, FX pairs and accounts the demo portfolio is built from."""
from dataclasses import dataclass, field


@dataclass(frozen=True)
class Instrument:
    symbol: str  # as brokers write it
    yahoo: str  # as Yahoo writes it
    name: str
    currency: str  # ISO currency the holding settles in
    quote_currency: str  # what Yahoo reports (GBp for London)
    exchange: str
    timezone: str
    start_price: float  # in quote_currency, at the start of the history
    drift: float  # annual
    vol: float  # annual
    dividend_yield: float = 0.0
    security_type: str = "cs"  # SnapTrade security type code (cs = common stock, et = ETF)

    @property
    def minor_unit(self) -> int:
        return 100 if self.quote_currency != self.currency else 1


def _tsx(symbol, yahoo, name, price, drift, vol, yld=0.0, kind="cs"):
    return Instrument(symbol, yahoo, name, "CAD", "CAD", "TSX", "America/Toronto", price, drift, vol, yld, kind)


def _us(symbol, yahoo, name, exchange, price, drift, vol, yld=0.0, kind="cs"):
    return Instrument(symbol, yahoo, name, "USD", "USD", exchange, "America/New_York", price, drift, vol, yld, kind)


INSTRUMENTS = {i.symbol: i for i in [
    _tsx("RY.TO", "RY.TO", "Royal Bank of Canada", 128.0, 0.12, 0.17, 0.038),
    _tsx("TD.TO", "TD.TO", "Toronto-Dominion Bank", 82.0, 0.04, 0.19, 0.050),
    _tsx("ENB.TO", "ENB.TO", "Enbridge Inc.", 48.0, 0.08, 0.16, 0.068),
    _tsx("SHOP.TO", "SHOP.TO", "Shopify Inc.", 92.0, 0.22, 0.45),
    _tsx("BBD.B.TO", "BBD-B.TO", "Bombardier Inc. Class B", 52.0, 0.25, 0.42),
    _tsx("CNR.TO", "CNR.TO", "Canadian National Railway", 165.0, 0.02, 0.18, 0.021),
    _tsx("XEQT.TO", "XEQT.TO", "iShares Core Equity ETF Portfolio", 27.0, 0.11, 0.12, 0.018, "et"),
    _tsx("VFV.TO", "VFV.TO", "Vanguard S&P 500 Index ETF", 112.0, 0.14, 0.14, 0.011, "et"),
    _tsx("XIU.TO", "XIU.TO", "iShares S&P/TSX 60 Index ETF", 31.0, 0.09, 0.12, 0.028, "et"),
    _tsx("ZAG.TO", "ZAG.TO", "BMO Aggregate Bond Index ETF", 13.6, 0.01, 0.05, 0.034, "et"),
    _us("AAPL", "AAPL", "Apple Inc.", "NASDAQ", 172.0, 0.14, 0.26, 0.005),
    _us("MSFT", "MSFT", "Microsoft Corporation", "NASDAQ", 335.0, 0.15, 0.24, 0.008),
    _us("NVDA", "NVDA", "NVIDIA Corporation", "NASDAQ", 46.0, 0.45, 0.50),
    _us("GOOGL", "GOOGL", "Alphabet Inc. Class A", "NASDAQ", 136.0, 0.16, 0.28, 0.004),
    _us("AMZN", "AMZN", "Amazon.com, Inc.", "NASDAQ", 142.0, 0.17, 0.30),
    _us("VOO", "VOO", "Vanguard S&P 500 ETF", "NYSE ARCA", 405.0, 0.13, 0.14, 0.013, "et"),
    _us("BRK.B", "BRK-B", "Berkshire Hathaway Inc. Class B", "NYSE", 352.0, 0.12, 0.17),
    Instrument("VOD.L", "VOD.L", "Vodafone Group plc", "GBP", "GBp", "LSE", "Europe/London",
               72.0, 0.03, 0.24, 0.070),
]}

# Yahoo FX ticker -> (start rate, annual vol)
FX_PAIRS = {"USDCAD=X": (1.36, 0.025), "GBPCAD=X": (1.72, 0.03)}


@dataclass(frozen=True)
class Profile:
    """The parts of Yahoo's Ticker.info the holdings table reads (real public values, roughly)."""
    website: str
    sector: str | None = None  # Yahoo gives ETFs no sector, industry, country or market cap
    industry: str | None = None
    country: str | None = None
    shares_millions: float | None = None  # market cap = shares x live price
    pe: float | None = None


PROFILES = {
    "RY.TO": Profile("https://www.rbc.com", "Financial Services", "Banks - Diversified", "Canada", 1410, 14.8),
    "TD.TO": Profile("https://www.td.com", "Financial Services", "Banks - Diversified", "Canada", 1750, 11.9),
    "ENB.TO": Profile("https://www.enbridge.com", "Energy", "Oil & Gas Midstream", "Canada", 2180, 19.5),
    "SHOP.TO": Profile("https://www.shopify.com", "Technology", "Software - Application", "Canada", 1300, 95.0),
    "BBD.B.TO": Profile("https://bombardier.com", "Industrials", "Aerospace & Defense", "Canada", 98, 24.0),
    "CNR.TO": Profile("https://www.cn.ca", "Industrials", "Railroads", "Canada", 628, 18.6),
    "XEQT.TO": Profile("https://www.blackrock.com"),
    "VFV.TO": Profile("https://www.vanguard.ca"),
    "XIU.TO": Profile("https://www.blackrock.com"),
    "ZAG.TO": Profile("https://www.bmo.com"),
    "AAPL": Profile("https://www.apple.com", "Technology", "Consumer Electronics", "United States", 15000, 33.5),
    "MSFT": Profile("https://www.microsoft.com", "Technology", "Software - Infrastructure", "United States", 7430, 35.1),
    "NVDA": Profile("https://www.nvidia.com", "Technology", "Semiconductors", "United States", 24400, 52.0),
    "GOOGL": Profile("https://abc.xyz", "Communication Services", "Internet Content & Information", "United States",
                     12200, 24.3),
    "AMZN": Profile("https://www.aboutamazon.com", "Consumer Cyclical", "Internet Retail", "United States", 10500, 38.9),
    "VOO": Profile("https://investor.vanguard.com"),
    "BRK.B": Profile("https://www.berkshirehathaway.com", "Financial Services", "Insurance - Diversified",
                     "United States", 2160, 13.2),
    "VOD.L": Profile("https://www.vodafone.com", "Communication Services", "Telecom Services", "United Kingdom", 26000),
}


@dataclass(frozen=True)
class Holding:
    symbol: str
    monthly_budget: float  # in the account's trading currency for this symbol
    fractional: bool = False


@dataclass(frozen=True)
class TransferIn:
    """Shares moved in from another institution: present in positions, absent as a purchase."""
    symbol: str
    quantity: float
    average_cost: float
    months_ago: int


@dataclass(frozen=True)
class DemoAccount:
    institution: str
    number: str
    type: str  # Questrade `type` / SnapTrade `raw_type`
    client_account_type: str
    holdings: list[Holding]
    transfers: list[TransferIn] = field(default_factory=list)
    commission: float = 0.0
    sell_probability: float = 0.06  # chance per symbol per month of trimming the position


QUESTRADE_ACCOUNTS = [
    DemoAccount("Questrade", "51234567", "TFSA", "Individual", [
        Holding("RY.TO", 450), Holding("TD.TO", 300), Holding("ENB.TO", 350),
        Holding("XEQT.TO", 600), Holding("SHOP.TO", 250),
    ], commission=4.95),
    DemoAccount("Questrade", "51234890", "Margin", "Individual", [
        Holding("AAPL", 400), Holding("MSFT", 500), Holding("BBD.B.TO", 300),
    ], commission=4.95, sell_probability=0.1),
]

WEALTHSIMPLE_ACCOUNTS = [
    DemoAccount("Wealthsimple", "WK3N8Q2T", "TFSA", "", [
        Holding("VFV.TO", 500, True), Holding("XIU.TO", 300, True), Holding("CNR.TO", 200, True),
    ]),
    DemoAccount("Wealthsimple", "WK3N9F7R", "RRSP", "", [
        Holding("XEQT.TO", 700, True), Holding("ZAG.TO", 250, True),
    ], transfers=[TransferIn("TD.TO", 40, 74.10, 8)]),
]

IBKR_ACCOUNTS = [
    DemoAccount("Interactive Brokers", "U9876543", "Individual", "", [
        Holding("NVDA", 600), Holding("GOOGL", 400), Holding("AMZN", 400),
        Holding("VOO", 900), Holding("BRK.B", 350), Holding("VOD.L", 150),
    ], commission=1.0, sell_probability=0.08),
]
