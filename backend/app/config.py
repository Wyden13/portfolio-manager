from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    QUESTRADE_CLIENT_ID: str = ""
    QUESTRADE_REDIRECT_URI: str = ""
    QUESTRADE_LOGIN_URL: str = "https://login.questrade.com"
    SNAPTRADE_CLIENT_ID: str = ""
    SNAPTRADE_CONSUMER_KEY: str = ""
    TOKEN_ENCRYPTION_KEY: str = ""  # Fernet key
    DATABASE_URL: str = "sqlite:///./investiq.db"
    SYNC_INITIAL_LOOKBACK_DAYS: int = 365
    PNL_STREAM_INTERVAL_SECONDS: float = 5
    SYNC_INTERVAL_MINUTES: float = 60  # background sync of every connection; 0 disables it
    BASE_CURRENCY: str = "CAD"  # totals are also converted into this at spot FX


settings = Settings()
