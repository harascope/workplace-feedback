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

        result = await reports_repo.cancel_report(db_session, report_id, "u1")

        assert result == "cancelled"
        assert await reports_repo.pending_count(db_session) == 0

    async def test_non_owner_cannot_cancel(self, db_session: AsyncSession) -> None:
        report_id = await _add(db_session, author_id="u1")

        result = await reports_repo.cancel_report(db_session, report_id, "u3")

        # 本人以外には、存在するかどうかも配信済みかどうかも伝えない
        assert result == "not_found"
        assert await reports_repo.pending_count(db_session) == 1

    async def test_non_owner_is_not_told_that_it_was_delivered(
        self, db_session: AsyncSession
    ) -> None:
        report_id = await _add(db_session, author_id="u1")
        await reports_repo.mark_delivered(db_session, report_id, None)

        result = await reports_repo.cancel_report(db_session, report_id, "u3")

        assert result == "not_found"

    async def test_cannot_cancel_after_delivery(self, db_session: AsyncSession) -> None:
        report_id = await _add(db_session, author_id="u1")
        await reports_repo.mark_delivered(db_session, report_id, None)

        result = await reports_repo.cancel_report(db_session, report_id, "u1")

        # 配信済みと確定できるので、ここだけ断定してよい
        assert result == "delivered"

    async def test_unknown_id_is_not_found(self, db_session: AsyncSession) -> None:
        result = await reports_repo.cancel_report(db_session, "存在しないid", "u1")

        assert result == "not_found"


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


class TestSeedDemo:
    """デモ用サンプルデータ（POST /admin/seed-demo）。reset_to_seed とは別経路。"""

    async def test_inserts_a_mixed_data_set(self, db_session: AsyncSession) -> None:
        await reports_repo.seed_demo(db_session)

        reports = (await db_session.execute(select(Report))).scalars().all()
        assert 20 <= len(reports) <= 40
        delivered = [r for r in reports if r.status == "delivered"]
        pending = [r for r in reports if r.status == "pending"]
        assert delivered and pending
        # 配信済みには受信者向け文面があり、未配信にはまだ無い（配信時に生成する）
        assert all(r.composed is not None for r in delivered)
        assert all(r.composed is None for r in pending)
        # 重大度・応答が混ざっている
        assert {r.severity for r in reports} == {1, 2}
        assert {r.response for r in delivered} == {None, "ack", "dispute"}
        # レベル3は申告として保存しない（仕様書 3.1）
        assert all(r.severity < 3 for r in reports)
        # 自分あての申告は作らない
        assert all(r.author_id != r.target_id for r in reports)

        escalations = (await db_session.execute(select(Escalation))).scalars().all()
        assert len(escalations) == 2

    async def test_is_idempotent(self, db_session: AsyncSession) -> None:
        await reports_repo.seed_demo(db_session)
        first = len((await db_session.execute(select(Report))).scalars().all())

        await reports_repo.seed_demo(db_session)

        second = len((await db_session.execute(select(Report))).scalars().all())
        assert first == second

    async def test_replaces_whatever_was_there(self, db_session: AsyncSession) -> None:
        await _add(db_session, body="消えるはずの申告")

        await reports_repo.seed_demo(db_session)

        bodies = (await db_session.execute(select(Report.body))).scalars().all()
        assert "消えるはずの申告" not in bodies


class TestOldestPendingCreatedAt:
    async def test_none_when_nothing_is_pending(self, db_session: AsyncSession) -> None:
        assert await reports_repo.oldest_pending_created_at(db_session) is None

    async def test_ignores_delivered_and_returns_the_oldest(
        self, db_session: AsyncSession
    ) -> None:
        old_pending = await _add(db_session)
        await _add(db_session)
        delivered_id = await _add(db_session)
        await reports_repo.mark_delivered(db_session, delivered_id, None)
        # 配信済みのほうを最も古くしておく。拾われてはいけない
        await db_session.execute(
            Report.__table__.update()
            .where(Report.id == delivered_id)
            .values(created_at=datetime.now(UTC) - timedelta(days=20))
        )
        await db_session.execute(
            Report.__table__.update()
            .where(Report.id == old_pending)
            .values(created_at=datetime.now(UTC) - timedelta(days=5))
        )
        await db_session.commit()

        oldest = await reports_repo.oldest_pending_created_at(db_session)

        assert oldest is not None
        assert 4 <= (datetime.now(UTC) - oldest).days <= 5


class TestListDeliveredForEval:
    async def test_only_delivered_reports_are_returned(self, db_session: AsyncSession) -> None:
        delivered_id = await _add(db_session, target_id="u2", severity=2)
        await _add(db_session, target_id="u2", severity=1)  # pending のまま
        await reports_repo.mark_delivered(db_session, delivered_id, None)

        delivered = await reports_repo.list_delivered_for_eval(db_session)

        assert len(delivered) == 1
        assert delivered[0].target_id == "u2"
        assert delivered[0].severity == 2
