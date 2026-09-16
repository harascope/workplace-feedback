"""reports テーブルの読み書き。

移植元: src/lib/store.ts（addReport / cancelReport / listPending / markDelivered /
pendingCount / respond / resetStore / evaluateDepts 用データ取得 / purge）
"""

from datetime import UTC, datetime, timedelta
from typing import Literal
from uuid import uuid4

from sqlalchemy import delete, func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import Escalation, Report
from app.domain.rules import DeliveredReport

_SEED_COMPOSED = {
    "what": "会議中、相手の発言の途中で話し始めることがありました。",
    "why": (
        "発言を最後まで聞かれない経験が続くと、相手は会議で意見を出すことをやめていきます。"
        "発言の機会が実質的に失われ、チームの意思決定に入る視点が減ります。"
    ),
    "how": (
        "相手が話し終えるまで一拍置く、話を遮ってしまったと気づいたら「続けてください」と戻す、"
        "といった対応が考えられます。"
    ),
}


async def add_report(
    s: AsyncSession,
    *,
    author_id: str,
    target_id: str,
    severity: int,
    body: str,
    raw_body: str,
    has_context: bool,
) -> str:
    report = Report(
        id=str(uuid4()),
        author_id=author_id,
        target_id=target_id,
        severity=severity,
        body=body,
        raw_body=raw_body,
        has_context=has_context,
        status="pending",
        composed=None,
        response=None,
    )
    s.add(report)
    await s.commit()
    return report.id


async def cancel_report(s: AsyncSession, report_id: str, author_id: str) -> bool:
    """送信の取り消し。本人かつ pending のときだけ True。"""
    result = await s.execute(
        delete(Report).where(
            Report.id == report_id,
            Report.author_id == author_id,
            Report.status == "pending",
        )
    )
    await s.commit()
    return result.rowcount > 0


async def list_pending(s: AsyncSession) -> list[Report]:
    result = await s.execute(select(Report).where(Report.status == "pending"))
    return list(result.scalars().all())


async def mark_delivered(s: AsyncSession, report_id: str, composed: dict | None) -> None:
    await s.execute(
        update(Report).where(Report.id == report_id).values(status="delivered", composed=composed)
    )
    await s.commit()


async def pending_count(s: AsyncSession) -> int:
    result = await s.execute(
        select(func.count()).select_from(Report).where(Report.status == "pending")
    )
    return result.scalar_one()


async def list_delivered_for_eval(s: AsyncSession) -> list[DeliveredReport]:
    """配信済みだけを渡す（時期ぼかし。docs/api.md）。"""
    result = await s.execute(
        select(Report.target_id, Report.severity).where(Report.status == "delivered")
    )
    return [DeliveredReport(target_id=row.target_id, severity=row.severity) for row in result]


async def set_response(s: AsyncSession, report_id: str, kind: Literal["ack", "dispute"]) -> None:
    await s.execute(update(Report).where(Report.id == report_id).values(response=kind))
    await s.commit()


async def purge_old(s: AsyncSession, days: int) -> int:
    cutoff = datetime.now(UTC) - timedelta(days=days)
    result = await s.execute(delete(Report).where(Report.created_at < cutoff))
    await s.commit()
    return result.rowcount


async def reset_to_seed(s: AsyncSession) -> None:
    """シード状態に戻す（配信済み1件・未配信1件・引き継ぎ0件）。デモ用。

    移植元: src/lib/store.ts の seed()。文面はそのまま使う。
    """
    await s.execute(delete(Report))
    await s.execute(delete(Escalation))

    now = datetime.now(UTC)
    s.add(
        Report(
            id=str(uuid4()),
            author_id="u3",
            target_id="u2",
            severity=2,
            body="先月の定例会議で、話している途中で話し始めることがありました。",
            raw_body="先月の定例会議で、私が話している途中で話し始めることが3回ありました。",
            has_context=True,
            status="delivered",
            composed=_SEED_COMPOSED,
            response=None,
            created_at=now - timedelta(days=7),
        )
    )
    s.add(
        Report(
            id=str(uuid4()),
            author_id="u4",
            target_id="u2",
            severity=1,
            body="依頼のメッセージがいつも一言だけで、背景が分からないまま作業することがあります。",
            raw_body="依頼のメッセージがいつも一言だけで、背景が分からないまま作業することがあります。",
            has_context=False,
            status="pending",
            composed=None,
            response=None,
            created_at=now - timedelta(days=2),
        )
    )
    await s.commit()
