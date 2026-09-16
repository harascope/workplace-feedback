"""app/db/repositories/escalations.py のテスト。

人事への引き継ぎ（仕様書 3.1）は、受信箱にも部署評価にも混ざらない別テーブル（ARCHITECTURE.md）。
"""

from datetime import UTC, datetime, timedelta

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import Escalation, Report
from app.db.repositories import escalations as escalations_repo
from app.db.repositories import inbox as inbox_repo
from app.db.repositories import reports as reports_repo


class TestAddAndListEscalations:
    async def test_add_then_list_resolves_author_name(self, db_session: AsyncSession) -> None:
        escalation_id = await escalations_repo.add_escalation(
            db_session,
            author_id="u3",
            raw_body="上司に殴られた",
            severity_reason="暴力・脅迫等に該当しうる",
        )

        views = await escalations_repo.list_escalations(db_session)

        assert len(views) == 1
        assert views[0].id == escalation_id
        assert views[0].author_name == "鈴木 花子"
        assert views[0].raw_body == "上司に殴られた"
        assert views[0].severity_reason == "暴力・脅迫等に該当しうる"

    async def test_unknown_author_falls_back_to_the_raw_id(self, db_session: AsyncSession) -> None:
        await escalations_repo.add_escalation(
            db_session, author_id="does-not-exist", raw_body="…", severity_reason="…"
        )

        views = await escalations_repo.list_escalations(db_session)

        assert views[0].author_name == "does-not-exist"


class TestEscalationsAreIsolated:
    async def test_escalation_does_not_appear_in_inbox_or_report_aggregates(
        self, db_session: AsyncSession
    ) -> None:
        await escalations_repo.add_escalation(
            db_session, author_id="u3", raw_body="上司に殴られた", severity_reason="暴力"
        )

        # reports テーブルには何も無いので、受信箱・配信済み集計は空のまま
        assert await inbox_repo.list_inbox(db_session, "u2") == []
        assert await reports_repo.list_delivered_for_eval(db_session) == []
        assert await reports_repo.pending_count(db_session) == 0


class TestPurgeOld:
    async def test_only_old_rows_are_deleted(self, db_session: AsyncSession) -> None:
        old_id = await escalations_repo.add_escalation(
            db_session, author_id="u1", raw_body="古い引き継ぎ", severity_reason="理由"
        )
        new_id = await escalations_repo.add_escalation(
            db_session, author_id="u1", raw_body="新しい引き継ぎ", severity_reason="理由"
        )

        old_time = datetime.now(UTC) - timedelta(days=40)
        await db_session.execute(
            Escalation.__table__.update().where(Escalation.id == old_id).values(created_at=old_time)
        )
        await db_session.commit()

        deleted = await escalations_repo.purge_old(db_session, days=30)

        assert deleted == 1
        remaining = (await db_session.execute(select(Escalation.id))).scalars().all()
        assert remaining == [new_id]


class TestPurgeOldAcrossTables:
    """保持期限のパージは reports だけでなく escalations（実名・原文を持つ）も対象にすること。"""

    async def test_purging_both_repos_removes_old_rows_from_both_tables(
        self, db_session: AsyncSession
    ) -> None:
        old_report_id = await reports_repo.add_report(
            db_session,
            author_id="u1",
            target_id="u2",
            severity=1,
            body="整理後の文面",
            raw_body="原文",
            has_context=True,
        )
        new_report_id = await reports_repo.add_report(
            db_session,
            author_id="u1",
            target_id="u2",
            severity=1,
            body="整理後の文面",
            raw_body="原文",
            has_context=True,
        )
        old_escalation_id = await escalations_repo.add_escalation(
            db_session, author_id="u3", raw_body="上司に殴られた", severity_reason="暴力"
        )
        new_escalation_id = await escalations_repo.add_escalation(
            db_session, author_id="u3", raw_body="最近の相談", severity_reason="暴力"
        )

        old_time = datetime.now(UTC) - timedelta(days=40)
        await db_session.execute(
            Report.__table__.update().where(Report.id == old_report_id).values(created_at=old_time)
        )
        await db_session.execute(
            Escalation.__table__.update()
            .where(Escalation.id == old_escalation_id)
            .values(created_at=old_time)
        )
        await db_session.commit()

        deleted_reports = await reports_repo.purge_old(db_session, days=30)
        deleted_escalations = await escalations_repo.purge_old(db_session, days=30)

        assert deleted_reports == 1
        assert deleted_escalations == 1

        remaining_reports = (await db_session.execute(select(Report.id))).scalars().all()
        remaining_escalations = (await db_session.execute(select(Escalation.id))).scalars().all()
        assert remaining_reports == [new_report_id]
        assert remaining_escalations == [new_escalation_id]
