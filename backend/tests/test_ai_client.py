"""app/ai/client.py のテスト。

extract_json は純粋関数として、call_structured は google-genai SDK をモックして検証する
（実 API は呼ばない）。
"""

from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from pydantic import BaseModel

import app.ai.client as client_module
from app.ai.client import call_structured, extract_json


class _Dummy(BaseModel):
    value: int


class TestExtractJson:
    def test_strips_json_code_fence(self) -> None:
        text = '```json\n{"value": 1}\n```'
        assert extract_json(text) == {"value": 1}

    def test_strips_leading_preamble(self) -> None:
        text = 'はい、こちらがJSONです。\n{"value": 2}'
        assert extract_json(text) == {"value": 2}

    def test_extracts_outermost_braces_with_trailing_text(self) -> None:
        text = '{"value": 3}\n以上です。'
        assert extract_json(text) == {"value": 3}

    def test_extracts_outermost_braces_around_nested_object(self) -> None:
        text = '前置き {"value": {"inner": 4}} 後書き'
        assert extract_json(text) == {"value": {"inner": 4}}


def _fake_client(generate_content: AsyncMock) -> SimpleNamespace:
    models = SimpleNamespace(generate_content=generate_content)
    return SimpleNamespace(aio=SimpleNamespace(models=models))


class TestCallStructured:
    async def test_retries_once_then_succeeds(self, monkeypatch: pytest.MonkeyPatch) -> None:
        generate = AsyncMock(
            side_effect=[
                SimpleNamespace(text="不正なJSONです"),
                SimpleNamespace(text='{"value": 42}'),
            ]
        )
        monkeypatch.setattr(client_module, "_get_client", lambda: _fake_client(generate))

        result = await call_structured("prompt", _Dummy)

        assert result == _Dummy(value=42)
        assert generate.call_count == 2

    async def test_raises_after_exhausting_retries(self, monkeypatch: pytest.MonkeyPatch) -> None:
        generate = AsyncMock(return_value=SimpleNamespace(text="ずっと不正なJSON"))
        monkeypatch.setattr(client_module, "_get_client", lambda: _fake_client(generate))

        with pytest.raises(RuntimeError):
            await call_structured("prompt", _Dummy, max_retries=2)

        # 初回 + 再試行2回 = 合計3回
        assert generate.call_count == 3
