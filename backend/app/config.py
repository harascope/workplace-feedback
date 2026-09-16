"""アプリ設定。環境変数は docs/api.md「環境変数」節と一致させる。"""

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str
    gemini_api_key: str | None = None
    gemini_model: str = "gemini-3.1-flash-lite"
    retention_days: int = Field(default=30, gt=0)
    """0 以下だと基準時刻が現在以降になり新しい行まで消えるため、1 以上を強制する。"""


settings = Settings()
