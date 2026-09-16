"""敵対的レビュー指摘分のテスト。

1. パージの部分失敗: escalations 側が例外を投げても reports 側の削除は実行され、
   それぞれ独立にログへ失敗・成功が出ること（docs/api.md「保持期限」節）。
2. retention_days の下限: 0 以下だと基準時刻が現在以降になり新しい行まで消えるため、
   Settings 生成時に弾かれること。
"""

from datetime import UTC, datetime, timedelta
from unittest.mock import AsyncMock

import pytest
from pydantic import ValidationError
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

import app.main as main_module
from app.config import Settings
from app.db.models import Report
from app.db.repositories import escalations as escalations_repo
from app.db.repositories import reports as reports_repo


class TestPurgePartialFailure:
    async def test_escalations_failure_does_not_block_reports_delete(
        self, db_session: AsyncSession, db_engine, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """escalations 側の purge_old が例外を投げても reports 側は削除される。"""
        old = datetime.now(UTC) - timedelta(days=100)
        db_session.add(
            Report(
                id="r1",
                author_id="u1",
                target_id="u2",
                severity=1,
                body="b",
                raw_body="rb",
                has_context=True,
                status="pending",
                created_at=old,
            )
        )
        await db_session.commit()

        _engine, factory = db_engine

        async def _override_get_session():
            async with factory() as session:
                yield session

        monkeypatch.setattr(main_module, "get_session", _override_get_session)
        monkeypatch.setattr(main_module.settings, "retention_days", 30)
        monkeypatch.setattr(
            escalations_repo,
            "purge_old",
            AsyncMock(side_effect=RuntimeError("escalations purge boom")),
        )

        await main_module._purge_once()

        remaining = (await db_session.execute(select(Report))).scalars().all()
        assert remaining == []

    async def test_each_purge_logs_independently(
        self, db_session: AsyncSession, db_engine, monkeypatch: pytest.MonkeyPatch, caplog
    ) -> None:
        """reports は成功ログ、escalations は失敗ログが個別に出る。本文・author_id は出ない。"""
        _engine, factory = db_engine

        async def _override_get_session():
            async with factory() as session:
                yield session

        monkeypatch.setattr(main_module, "get_session", _override_get_session)
        monkeypatch.setattr(main_module.settings, "retention_days", 30)
        monkeypatch.setattr(
            escalations_repo,
            "purge_old",
            AsyncMock(side_effect=RuntimeError("escalations purge boom")),
        )

        with caplog.at_level("INFO"):
            await main_module._purge_once()

        messages = [r.message for r in caplog.records] + [
            r.exc_text or "" for r in caplog.records
        ]
        joined = "\n".join(str(m) for m in messages)
        assert "申告を 0 件パージしました" in joined
        assert "引き継ぎのパージに失敗しました" in joined
        # 個人情報が漏れていないこと
        assert "u1" not in joined
        assert "書いた本人の原文" not in joined

    async def test_reports_failure_does_not_block_escalations_delete(
        self, db_session: AsyncSession, db_engine, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """reports 側が失敗しても escalations 側は実行される（逆方向の確認）。"""
        deleted = await escalations_repo.purge_old(db_session, 30)
        assert deleted == 0  # ベースライン: 空でも例外にならない

        _engine, factory = db_engine

        async def _override_get_session():
            async with factory() as session:
                yield session

        monkeypatch.setattr(main_module, "get_session", _override_get_session)
        monkeypatch.setattr(main_module.settings, "retention_days", 30)
        monkeypatch.setattr(
            reports_repo,
            "purge_old",
            AsyncMock(side_effect=RuntimeError("reports purge boom")),
        )
        escalations_purge = AsyncMock(return_value=0)
        monkeypatch.setattr(escalations_repo, "purge_old", escalations_purge)

        await main_module._purge_once()

        escalations_purge.assert_awaited_once()


class TestRetentionDaysLowerBound:
    def test_zero_is_rejected(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setenv("DATABASE_URL", "sqlite+aiosqlite://")
        monkeypatch.setenv("RETENTION_DAYS", "0")
        with pytest.raises(ValidationError):
            Settings()

    def test_negative_is_rejected(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setenv("DATABASE_URL", "sqlite+aiosqlite://")
        monkeypatch.setenv("RETENTION_DAYS", "-1")
        with pytest.raises(ValidationError):
            Settings()

    def test_positive_is_accepted(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setenv("DATABASE_URL", "sqlite+aiosqlite://")
        monkeypatch.setenv("RETENTION_DAYS", "1")
        assert Settings().retention_days == 1
