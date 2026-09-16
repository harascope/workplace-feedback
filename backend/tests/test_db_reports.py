"""app/db/repositories/reports.py のテスト。SQLite（aiosqlite）をテストごとに作り直して使う。"""

from datetime import UTC, datetime, timedelta
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import Escalation, Report
from app.db.repositories import escalations as escalations_repo
from app.db.repositories import reports as reports_repo


async def _add(session: AsyncSession, **over) -> str:  # noqa: ANN003
    defaults = dict(
        author_id="u1",
        target_id="u2",
        severity=1,
        body="整理後の文面",
        raw_body="書いた本人の原文",
        has_context=True,
    )
    defaults.update(over)
    return await reports_repo.add_report(session, **defaults)


class TestAddReport:
    async def test_id_is_uuid_without_timestamp(self, db_session: AsyncSession) -> None:
        before = datetime.now(UTC)
        report_id = await _add(db_session)
        after = datetime.now(UTC)

        # 形式として UUID であること
        parsed = UUID(report_id)
        assert parsed.version == 4

        # UUID4（乱数ベース）なので時刻は含まれない。作成時刻は created_at にだけ記録する
        row = (await db_session.execute(select(Report).where(Report.id == report_id))).scalar_one()
        created_at = row.created_at
        if created_at.tzinfo is None:
            # SQLite は TZ 付き型を持たないため、読み戻すと naive になることがある
            created_at = created_at.replace(tzinfo=UTC)
        assert before <= created_at <= after
        assert row.status == "pending"


class TestCancelReport:
    async def test_owner_can_cancel_while_pending(self, db_session: AsyncSession) -> None:
        report_id = await _add(db_session, author_id="u1")

        ok = await reports_repo.cancel_report(db_session, report_id, "u1")

        assert ok is True
        assert await reports_repo.pending_count(db_session) == 0

    async def test_non_owner_cannot_cancel(self, db_session: AsyncSession) -> None:
        report_id = await _add(db_session, author_id="u1")

        ok = await reports_repo.cancel_report(db_session, report_id, "u3")

        assert ok is False
        assert await reports_repo.pending_count(db_session) == 1

    async def test_cannot_cancel_after_delivery(self, db_session: AsyncSession) -> None:
        report_id = await _add(db_session, author_id="u1")
        await reports_repo.mark_delivered(db_session, report_id, None)

        ok = await reports_repo.cancel_report(db_session, report_id, "u1")

        assert ok is False


class TestPurgeOld:
    async def test_only_old_rows_are_deleted(self, db_session: AsyncSession) -> None:
        old_id = await _add(db_session, author_id="u1")
        new_id = await _add(db_session, author_id="u1")

        old_time = datetime.now(UTC) - timedelta(days=40)
        await db_session.execute(
            Report.__table__.update().where(Report.id == old_id).values(created_at=old_time)
        )
        await db_session.commit()

        deleted = await reports_repo.purge_old(db_session, days=30)

        assert deleted == 1
        remaining = (await db_session.execute(select(Report.id))).scalars().all()
        assert remaining == [new_id]


class TestResetToSeed:
    async def test_resets_to_seed_shape(self, db_session: AsyncSession) -> None:
        # シード後の状態を汚しておき、reset で元に戻ることを確認する
        await _add(db_session, author_id="u1")
        await escalations_repo.add_escalation(
            db_session, author_id="u1", raw_body="何かあった", severity_reason="理由"
        )

        await reports_repo.reset_to_seed(db_session)

        reports = (await db_session.execute(select(Report))).scalars().all()
        assert len(reports) == 2
        statuses = sorted(r.status for r in reports)
        assert statuses == ["delivered", "pending"]

        escalations = (await db_session.execute(select(Escalation))).scalars().all()
        assert escalations == []


class TestListDeliveredForEval:
    async def test_only_delivered_reports_are_returned(self, db_session: AsyncSession) -> None:
        delivered_id = await _add(db_session, target_id="u2", severity=2)
        await _add(db_session, target_id="u2", severity=1)  # pending のまま
        await reports_repo.mark_delivered(db_session, delivered_id, None)

        delivered = await reports_repo.list_delivered_for_eval(db_session)

        assert len(delivered) == 1
        assert delivered[0].target_id == "u2"
        assert delivered[0].severity == 2
