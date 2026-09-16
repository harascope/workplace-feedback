"""app/main.py の保持期限パージループ・起動処理のテスト。"""

import asyncio
from unittest.mock import AsyncMock

import pytest
from fastapi.testclient import TestClient

import app.main as main_module


class TestLifespanStartup:
    def test_health_ok_even_if_startup_purge_fails(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """起動時の _purge_once が例外を投げても、lifespan は完了し /health は 200 を返す。

        マイグレーション未適用の DB に繋いだ直後など、保持期限の掃除が失敗しても
        サービス自体は上がるようにするため（起動できないと healthcheck が落ちる）。
        """
        monkeypatch.setattr(
            main_module, "_purge_once", AsyncMock(side_effect=RuntimeError("no such table"))
        )
        monkeypatch.setattr(main_module, "make_engine", lambda *_args, **_kwargs: None)

        with TestClient(main_module.app) as test_client:
            r = test_client.get("/health")

        assert r.status_code == 200
        assert r.json() == {"ok": True}


class TestPurgeLoop:
    async def test_continues_after_exception_on_first_iteration(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """1周目で例外が飛んでも、2周目以降は止まらずに _purge_once を呼び続ける。"""
        purge_once = AsyncMock(
            side_effect=[RuntimeError("boom"), None, asyncio.CancelledError()]
        )
        monkeypatch.setattr(main_module, "_purge_once", purge_once)
        monkeypatch.setattr(main_module.asyncio, "sleep", AsyncMock(return_value=None))

        # 3周目の CancelledError で無限ループを抜けさせる（asyncio.sleep をモックしているため）
        with pytest.raises(asyncio.CancelledError):
            await main_module._purge_loop()

        assert purge_once.call_count == 3
