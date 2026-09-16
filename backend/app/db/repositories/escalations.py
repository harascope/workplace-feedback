"""escalations テーブルの読み書き。人事への引き継ぎ（仕様書 3.1）。

移植元: src/lib/store.ts の addEscalation / listEscalations。
受信箱・部署評価はこのテーブルを一切読まない（別配列として扱う）。
"""

from uuid import uuid4

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import Escalation
from app.domain.schemas import EscalationView
from app.domain.users import user_by_id


async def add_escalation(
    s: AsyncSession, *, author_id: str, raw_body: str, severity_reason: str
) -> str:
    escalation = Escalation(
        id=str(uuid4()),
        author_id=author_id,
        raw_body=raw_body,
        severity_reason=severity_reason,
    )
    s.add(escalation)
    await s.commit()
    return escalation.id


async def list_escalations(s: AsyncSession) -> list[EscalationView]:
    result = await s.execute(select(Escalation).order_by(Escalation.created_at))
    views = []
    for e in result.scalars().all():
        user = user_by_id(e.author_id)
        views.append(
            EscalationView(
                id=e.id,
                author_name=user.name if user is not None else e.author_id,
                raw_body=e.raw_body,
                severity_reason=e.severity_reason,
                created_at=e.created_at,
            )
        )
    return views
