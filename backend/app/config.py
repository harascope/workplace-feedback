"""アプリ設定。環境変数は docs/api.md「環境変数」節と一致させる。"""

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str
    gemini_api_key: str | None = None
    gemini_model: str = "gemini-3.1-flash-lite"
    retention_days: int = 30


settings = Settings()
