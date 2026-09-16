"""アプリ設定。環境変数は docs/api.md「環境変数」節と一致させる。"""

from typing import Literal

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str
    ai_provider: Literal["gemini", "ollama"] = "gemini"
    """AI の呼び出し先。ollama はローカル推論（課金なし）。"""
    gemini_api_key: str | None = None
    gemini_model: str = "gemini-3.1-flash-lite"
    ollama_base_url: str = "http://127.0.0.1:11434"
    ollama_model: str = "gemma3:12b"
    """gemma4:e4b は思考モデルで遅い（中央値8〜10秒）。gemma3:12b は同等の精度で0.6〜1秒。"""
    retention_days: int = Field(default=30, gt=0)
    """0 以下だと基準時刻が現在以降になり新しい行まで消えるため、1 以上を強制する。"""


settings = Settings()
