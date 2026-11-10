from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    QUESTRADE_CLIENT_ID: str = ""
    QUESTRADE_REDIRECT_URI: str = ""
    QUESTRADE_LOGIN_URL: str = "https://login.questrade.com"
    TOKEN_ENCRYPTION_KEY: str = ""  # Fernet key
    DATABASE_URL: str = "sqlite:///./investiq.db"


settings = Settings()
