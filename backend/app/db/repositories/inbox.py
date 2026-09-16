"""受信箱の read model。匿名性の要。

移植元: src/lib/store.ts の listInbox()。

select() の列に author_id / raw_body を含めない。ORM オブジェクト（Report）を取得して
あとから間引く実装は、将来だれかがフィールドを足したときに漏らせてしまうので避ける。
受信箱の組み立ては必ずこのファイルで完結させ、他の層に生の Report を渡さないこと。
"""

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import Report
from app.domain.schemas import Composed, InboxItem


async def list_inbox(s: AsyncSession, user_id: str) -> list[InboxItem]:
    stmt = select(
        Report.id,
        Report.body,
        Report.has_context,
        Report.composed,
        Report.response,
    ).where(Report.target_id == user_id, Report.status == "delivered")

    result = await s.execute(stmt)
    return [
        InboxItem(
            id=row.id,
            body=row.body,
            has_context=row.has_context,
            composed=Composed(**row.composed) if row.composed is not None else None,
            response=row.response,
        )
        for row in result
    ]
