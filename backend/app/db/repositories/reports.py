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


CancelResult = Literal["cancelled", "delivered", "not_found"]
"""取り消しの結果。呼び出し側が理由ごとに文言を変えられるようにする。"""


async def cancel_report(s: AsyncSession, report_id: str, author_id: str) -> CancelResult:
    """送信の取り消し。本人かつ pending のときだけ消す。

    失敗したときは理由を返す。bool だと「配信済み」と「見つからない」を区別できず、
    画面に「すでに配信されたため取り消せません」と断定して出すことになる。
    実際には届いていないのに「届いた」と読める文言は、送信者を最も不安にさせる誤りなので、
    **配信済みと確定できるときだけ断定する**。

    理由を調べるクエリにも author_id を掛ける。本人以外には、その申告が存在するかどうかも
    配信済みかどうかも伝えない（常に not_found になる）。
    """
    result = await s.execute(
        delete(Report).where(
            Report.id == report_id,
            Report.author_id == author_id,
            Report.status == "pending",
        )
    )
    await s.commit()
    if result.rowcount > 0:
        return "cancelled"

    status = (
        await s.execute(
            select(Report.status).where(Report.id == report_id, Report.author_id == author_id)
        )
    ).scalar_one_or_none()
    return "delivered" if status == "delivered" else "not_found"


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
    """配信済みだけを渡す（時期ぼかし。docs/api.md）。

    author_id は「異なる申告者の数」を数えるためだけに使う（仕様書 3.3 / 6.2）。
    管理者向けの応答には出さない。
    """
    result = await s.execute(
        select(Report.target_id, Report.severity, Report.author_id).where(
            Report.status == "delivered"
        )
    )
    return [
        DeliveredReport(target_id=row.target_id, severity=row.severity, author_id=row.author_id)
        for row in result
    ]


async def oldest_pending_created_at(s: AsyncSession) -> datetime | None:
    """いちばん古い未配信の作成時刻。未配信が無ければ None。

    次の配信までにどれだけ待たせているかを管理者に示すために使う（仕様書 5.1）。
    """
    result = await s.execute(
        select(func.min(Report.created_at)).where(Report.status == "pending")
    )
    oldest = result.scalar_one_or_none()
    if oldest is None:
        return None
    # SQLite は TZ 付き型を持たないため、読み戻すと naive になることがある
    return oldest if oldest.tzinfo is not None else oldest.replace(tzinfo=UTC)


async def set_response(s: AsyncSession, report_id: str, kind: Literal["ack", "dispute"]) -> None:
    await s.execute(update(Report).where(Report.id == report_id).values(response=kind))
    await s.commit()


async def purge_old(s: AsyncSession, days: int) -> int:
    cutoff = datetime.now(UTC) - timedelta(days=days)
    result = await s.execute(delete(Report).where(Report.created_at < cutoff))
    await s.commit()
    return result.rowcount


# --- デモ用のサンプルデータ（POST /admin/seed-demo） ---

_WHY = {
    1: (
        "こうした進め方が続くと、受け取った側は見通しを立てにくくなり、"
        "確認や相談を切り出しづらくなることがあります。"
    ),
    2: (
        "同じことが繰り返されると、受け取った側は発言や相談の機会を失い、"
        "仕事への関わり方そのものが狭まっていきます。"
    ),
}

_HOW = {
    1: (
        "一般に、依頼の背景や期限の理由を一言添える、変更が出た時点で早めに共有する、"
        "といった進め方が挙げられます。"
    ),
    2: (
        "一般に、指摘は人前ではなく個別の場で行う、相手が話し終えるまで一拍置く、"
        "といった対応が挙げられます。"
    ),
}

# (日数前, 送信者, 対象者, 重大度, 配信済みか, 応答, 場面あり, 本文)
# 名簿（app/domain/users.py）の6人と部署構成に沿わせる。
#   営業部(u1/u2/u3) … 配信済みが多く、重大度2の比率が高い。複数名に分散 → 部署アラートが出る
#   開発部(u4)       … 配信済みはあるが1人部署なので母数下限に満たない → アラートは出さない
#   管理部(u5/u6)    … 未配信だけ。配信済みが無いので部署評価は「データなし」になる
# 本文は職場でありそうな範囲にとどめ、特定の人物を攻撃する文面にしない。
_DEMO_REPORTS: list[tuple[int, str, str, int, bool, str | None, bool, str]] = [
    # 営業部・配信済み
    (34, "u3", "u2", 2, True, "ack", True,
     "先月の定例会議で、報告の途中で話を引き取られることが続きました。"),
    (30, "u1", "u2", 2, True, None, True,
     "打ち合わせの場で、同じ指摘を人前で繰り返し受けました。"),
    (27, "u6", "u2", 2, True, "ack", True,
     "急ぎでない依頼でも、毎回その日のうちの対応を求められました。"),
    (24, "u3", "u2", 2, True, "dispute", True,
     "客先からの帰り道で担当を替えると言われ、理由の説明はありませんでした。"),
    (18, "u4", "u2", 2, True, None, False,
     "発言しようとすると、話の途中で別の話題に移されることがあります。"),
    (11, "u1", "u2", 2, True, "ack", True,
     "朝礼で、前週に共有した予定と違う作業を当日に頼まれました。"),
    (21, "u3", "u1", 1, True, None, False,
     "共有の資料が更新されないまま、確認だけを求められることがありました。"),
    (14, "u4", "u3", 1, True, "ack", True,
     "定例の議事録の担当が、相談のないまま決まっていました。"),
    # 営業部・未配信
    (5, "u3", "u2", 1, False, None, False,
     "予定表に無い打ち合わせが、当日に入ることがありました。"),
    (3, "u4", "u2", 1, False, None, True,
     "依頼の期限が、後から前倒しされることがありました。"),
    (2, "u1", "u2", 2, False, None, True,
     "人前で長い時間、同じ指摘を受けることが続いています。"),
    # 開発部・配信済み
    (33, "u1", "u4", 1, True, "ack", True,
     "仕様の確認に返信がないまま、着手を求められることがありました。"),
    (26, "u3", "u4", 1, True, None, False,
     "レビューの指摘が口頭だけで、記録に残らないことがありました。"),
    (20, "u5", "u4", 2, True, None, True,
     "リリース前の相談が、毎回当日になっていました。"),
    (16, "u6", "u4", 1, True, "ack", True,
     "作業の見積もりを確認しないまま、日程が決まることがありました。"),
    (9, "u1", "u4", 1, True, "dispute", False,
     "確認の依頼が、期限の当日に届くことがありました。"),
    (6, "u2", "u4", 1, True, None, True,
     "打ち合わせの予定が、直前に取り消されることが続きました。"),
    # 開発部・未配信
    (4, "u6", "u4", 1, False, None, True,
     "レビューの依頼が、いつも期限の直前になっていました。"),
    # 管理部・未配信のみ（配信済みが無いので「データなし」になる）
    (8, "u4", "u5", 2, False, None, True,
     "全社への連絡が、担当者を通さずに変わることがありました。"),
    (6, "u1", "u5", 1, False, None, True,
     "経費の申請の差し戻しに、理由が書かれていないことがありました。"),
    (2, "u3", "u6", 1, False, None, False,
     "問い合わせの返信が、数日空くことがありました。"),
    (1, "u6", "u5", 1, False, None, True,
     "手続きの期限が、周知の前に過ぎていることがありました。"),
]

# (日数前, 送信者, 判定理由, 原文)。本人が実名での引き継ぎに同意したものだけが入る（仕様書 3.1）。
_DEMO_ESCALATIONS: list[tuple[int, str, str, str]] = [
    (25, "u3", "暴力・脅迫等に該当しうる",
     "面談の場で書類を投げつけられ、大声で怒鳴られました。"),
    (10, "u4", "ストーカー行為に該当しうる",
     "断ったあとも、個人的な連絡が繰り返し届くようになりました。"),
]


async def seed_demo(s: AsyncSession) -> None:
    """デモ用のサンプルデータを入れる（POST /admin/seed-demo）。

    reset_to_seed とは別経路にする。reset_to_seed の件数（配信済み1件・未配信1件・
    引き継ぎ0件）は E2E が依存しているため変えない。

    何度押しても同じ状態になるよう、入れ直す前に全件消す。
    """
    await s.execute(delete(Report))
    await s.execute(delete(Escalation))

    now = datetime.now(UTC)
    for days_ago, author_id, target_id, severity, is_delivered, response, has_context, body in (
        _DEMO_REPORTS
    ):
        s.add(
            Report(
                id=str(uuid4()),
                author_id=author_id,
                target_id=target_id,
                severity=severity,
                body=body,
                raw_body=body,
                has_context=has_context,
                status="delivered" if is_delivered else "pending",
                # 未配信の受信者向け文面は配信時に生成する（docs/api.md）。ここでは持たせない
                composed=(
                    {"what": body, "why": _WHY[severity], "how": _HOW[severity]}
                    if is_delivered
                    else None
                ),
                response=response,
                created_at=now - timedelta(days=days_ago),
            )
        )

    for days_ago, author_id, severity_reason, raw_body in _DEMO_ESCALATIONS:
        s.add(
            Escalation(
                id=str(uuid4()),
                author_id=author_id,
                raw_body=raw_body,
                severity_reason=severity_reason,
                created_at=now - timedelta(days=days_ago),
            )
        )

    await s.commit()


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
