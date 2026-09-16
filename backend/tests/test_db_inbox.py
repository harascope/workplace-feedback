"""app/db/repositories/inbox.py のテスト。匿名性の要（author_id / raw_body を出さない）。"""

from sqlalchemy.ext.asyncio import AsyncSession

from app.db.repositories import inbox as inbox_repo
from app.db.repositories import reports as reports_repo


async def _add(session: AsyncSession, **over) -> str:  # noqa: ANN003
    defaults = dict(
        author_id="u1",
        target_id="u2",
        severity=1,
        body="整理後の文面",
        raw_body="書いた本人の原文（漏れてはいけない）",
        has_context=True,
    )
    defaults.update(over)
    return await reports_repo.add_report(session, **defaults)


class TestListInbox:
    async def test_returns_only_delivered_for_target(self, db_session: AsyncSession) -> None:
        delivered_id = await _add(db_session, target_id="u2")
        await _add(db_session, target_id="u2")  # pending のまま
        await _add(db_session, target_id="u4")  # 別人宛て
        await reports_repo.mark_delivered(db_session, delivered_id, None)

        inbox = await inbox_repo.list_inbox(db_session, "u2")

        assert [item.id for item in inbox] == [delivered_id]

    async def test_item_has_no_author_id_or_raw_body(self, db_session: AsyncSession) -> None:
        report_id = await _add(
            db_session, target_id="u2", raw_body="書いた本人の原文（漏れてはいけない）"
        )
        await reports_repo.mark_delivered(db_session, report_id, None)

        inbox = await inbox_repo.list_inbox(db_session, "u2")

        item = inbox[0]
        assert not hasattr(item, "author_id")
        assert not hasattr(item, "raw_body")
        assert set(type(item).model_fields) == {"id", "body", "has_context", "composed", "response"}

    async def test_query_does_not_select_author_id_or_raw_body_columns(
        self, db_session: AsyncSession, sql_capture: list[str]
    ) -> None:
        report_id = await _add(db_session, target_id="u2", author_id="u1")
        await reports_repo.mark_delivered(db_session, report_id, None)
        sql_capture.clear()

        await inbox_repo.list_inbox(db_session, "u2")

        select_statements = [s for s in sql_capture if s.strip().upper().startswith("SELECT")]
        assert select_statements, "SELECT が発行されていない"
        for stmt in select_statements:
            assert "author_id" not in stmt
            assert "raw_body" not in stmt
