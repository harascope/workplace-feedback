"""app/db/repositories/escalations.py のテスト。

人事への引き継ぎ（仕様書 3.1）は、受信箱にも部署評価にも混ざらない別テーブル（ARCHITECTURE.md）。
"""

from sqlalchemy.ext.asyncio import AsyncSession

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
