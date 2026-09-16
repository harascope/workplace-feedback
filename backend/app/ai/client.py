"""Gemini 呼び出しの共通処理。移植元: src/lib/ai/client.ts

構造化出力の検証は Pydantic モデルで行う（TS 版は zod）。
"""

import json
import os
import re
from typing import Any

from google import genai
from google.genai import types
from pydantic import BaseModel, ValidationError

from app.config import settings

_client: genai.Client | None = None


def is_stub_mode() -> bool:
    """GEMINI_API_KEY が未設定なら True。"""
    return not os.environ.get("GEMINI_API_KEY")


def _get_client() -> genai.Client:
    global _client
    if _client is None:
        api_key = os.environ.get("GEMINI_API_KEY")
        if not api_key:
            raise RuntimeError("GEMINI_API_KEY が設定されていません（環境変数を確認してください）")
        _client = genai.Client(api_key=api_key)
    return _client


def extract_json(text: str) -> Any:
    """```json の剥がし＋最外 {} の抽出。"""
    cleaned = re.sub(r"```json", "", text, flags=re.IGNORECASE)
    cleaned = cleaned.replace("```", "").strip()
    # 前後に説明が混ざった場合に備えて最外の { } を拾う
    start = cleaned.find("{")
    end = cleaned.rfind("}")
    sliced = cleaned[start : end + 1] if start >= 0 and end > start else cleaned
    return json.loads(sliced)


async def call_structured[T: BaseModel](
    prompt: str,
    model: type[T],
    *,
    max_tokens: int = 1200,
    max_retries: int = 2,
) -> T:
    """プロンプトを投げ、Pydantic モデルで検証した値を返す。

    パース・検証に失敗した場合は、失敗理由を添えて最大 max_retries 回まで投げ直す
    （初回 + 再試行で合計 max_retries + 1 回）。
    """
    last_error = ""

    for attempt in range(max_retries + 1):
        content = (
            prompt
            if attempt == 0
            else f"{prompt}\n\n## 直前の出力は不正でした\n"
            f"理由: {last_error}\nJSONのみを、指定したキーと型のとおりに出力し直してください。"
        )

        res = await _get_client().aio.models.generate_content(
            model=settings.gemini_model,
            contents=content,
            config=types.GenerateContentConfig(
                # JSON で返させる。それでも崩れることはあるので extract_json と再試行は残す
                response_mime_type="application/json",
                max_output_tokens=max_tokens,
            ),
        )

        text = res.text or ""

        try:
            return model.model_validate(extract_json(text))
        except (json.JSONDecodeError, ValidationError) as e:
            last_error = str(e)

    raise RuntimeError(f"構造化出力の取得に失敗しました: {last_error}")
