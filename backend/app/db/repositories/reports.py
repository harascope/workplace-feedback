"""reports テーブルの読み書き。

移植元: src/lib/store.ts（addReport / cancelReport / listPending / markDelivered /
pendingCount / respond / resetStore / evaluateDepts 用データ取得 / purge）
"""

from datetime import UTC, datetime, timedelta
from typing import Literal, NamedTuple
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

class _Theme(NamedTuple):
    """申告のよくある型。重大度と、受信者向けの why / how をひと組で持つ。

    重大度を型ごとに固定するのは、本文と why がちぐはぐになるのを防ぐため。
    重大度だけを鍵にすると、全件が2種類の why を使い回すことになり、
    受け取りbox を続けて開いたときに同じ文面が並ぶ。
    """

    severity: int
    why: str
    """なぜ問題になりうるか（docs/spec.md 4.2 の composed）。"""
    how: str
    """一般的な対応の方向。送信者の要望としては書かない。"""


# レベル3は申告として保存しないので（仕様書 3.1）、ここには 1 と 2 しか置かない。
_THEMES: dict[str, _Theme] = {
    "interrupt": _Theme(
        2,
        "発言を最後まで聞かれない状態が続くと、受け取った側は会議で意見を出すことを"
        "やめていきます。発言の機会が実質的に失われ、意思決定に入る視点が減ります。",
        "一般に、相手が話し終えるまで一拍置く、遮ってしまったと気づいた時点で"
        "「続けてください」と戻す、といった対応が挙げられます。",
    ),
    "public_blame": _Theme(
        2,
        "人前での指摘が重なると、指摘の中身よりも見られていることへの緊張が残り、"
        "質問や相談を控えるようになります。早く共有されるべき問題ほど遅れて出てきます。",
        "一般に、指摘は個別の場で伝える、人前では事実の確認にとどめる、"
        "といった進め方が挙げられます。",
    ),
    "rush": _Theme(
        2,
        "期限が後から縮む状態が続くと、受け取った側は自分の予定を組めなくなり、"
        "常に手を空けて待つ働き方になります。他の作業の質も一緒に落ちます。",
        "一般に、依頼の時点で必要な期日とその理由を添える、前倒しが要るときは"
        "他の作業との優先順位を一緒に決める、といった進め方が挙げられます。",
    ),
    "no_reason": _Theme(
        2,
        "理由の分からない決定が続くと、受け取った側は自分の評価や立場を推測するしかなくなり、"
        "確認すること自体もためらうようになります。",
        "一般に、決まった経緯を一言添える、その場で質問を受ける時間を取る、"
        "といった対応が挙げられます。",
    ),
    "ignore": _Theme(
        2,
        "返答が返らない状態が続くと、受け取った側は相談そのものを諦め、"
        "問題を一人で抱えるようになります。周囲からは順調に見えたまま対応が遅れます。",
        "一般に、すぐ答えられないときも受け取ったことだけは返す、"
        "判断できる時期を伝える、といった対応が挙げられます。",
    ),
    "overload": _Theme(
        2,
        "作業が特定の人に寄り続けると、その人は断る余地を失い、"
        "休みも引き継ぎも取れない状態が固定されます。不調につながることがあります。",
        "一般に、割り振りの偏りを定期的に見直す、引き受けられる量を本人に確かめる、"
        "といった進め方が挙げられます。",
    ),
    "exclude": _Theme(
        2,
        "必要な情報が届かないまま進むと、受け取った側は判断の根拠を持てず、"
        "後から誤りだけを問われることになります。関わりの範囲も少しずつ狭まります。",
        "一般に、共有の範囲を決めた時点で対象者に伝える、後から加わった人に経緯を渡す、"
        "といった対応が挙げられます。",
    ),
    "privacy": _Theme(
        2,
        "相談した内容が本人の知らないところで共有されると、その後は誰にも相談できなくなります。"
        "相談の窓口そのものが使われなくなります。",
        "一般に、共有してよい範囲を本人に確かめる、相談の場で扱った内容は"
        "記録の要否を分けて決める、といった対応が挙げられます。",
    ),
    "schedule": _Theme(
        1,
        "予定が直前で動くことが重なると、受け取った側は前後の段取りを組めなくなり、"
        "確認や相談を切り出しづらくなります。",
        "一般に、変更が出た時点で早めに共有する、動かせない予定を先に確かめる、"
        "といった進め方が挙げられます。",
    ),
    "no_context": _Theme(
        1,
        "背景の分からない依頼が続くと、受け取った側は目的に合っているか確かめられないまま"
        "作業することになり、やり直しが増えます。",
        "一般に、依頼に目的と使いどころを一言添える、迷いやすい点を先に共有する、"
        "といった進め方が挙げられます。",
    ),
    "record": _Theme(
        1,
        "やり取りが口頭だけで残らないと、後から前提が食い違ったときに確かめる手立てがなく、"
        "受け取った側が説明を求められる側に回ります。",
        "一般に、決まったことを短くても書き残す、口頭で伝えた内容を共有の場に写す、"
        "といった対応が挙げられます。",
    ),
    "late_request": _Theme(
        1,
        "依頼が期限の直前に届く状態が続くと、受け取った側は確認する時間を取れず、"
        "気づいた点があっても言えないまま進めることになります。",
        "一般に、確認が要ると分かった時点で先に声を掛ける、見てほしい範囲を絞って伝える、"
        "といった進め方が挙げられます。",
    ),
    "stale_doc": _Theme(
        1,
        "古い資料のまま確認を求められると、受け取った側はどこが最新か分からないまま"
        "判断することになり、誤りの責任だけが残ります。",
        "一般に、更新の有無を先に伝える、直近の変更点をまとめて渡す、"
        "といった対応が挙げられます。",
    ),
    "assign_without_ask": _Theme(
        1,
        "相談のないまま担当が決まることが続くと、受け取った側は自分の予定や希望を"
        "伝える場を失い、役割が固定されていきます。",
        "一般に、決める前に本人へ一度確かめる、持ち回りの基準を共有しておく、"
        "といった進め方が挙げられます。",
    ),
}

class _DemoReport(NamedTuple):
    """デモ用の1件。重大度は theme が持つので、ここには置かない。"""

    days_ago: int
    author_id: str
    target_id: str
    theme: str
    delivered: bool
    response: Literal["ack", "dispute"] | None
    has_context: bool
    body: str


# 名簿（app/domain/users.py）の6人と部署構成に沿わせる。配信済みの配分は次の通り:
#   営業部(u1:4 / u2:6 / u3:4) … 計14件・重大度2が11件（比率 0.79）。複数名に分散し、
#                                異なる申告者も複数 → 5段階中4 ＋ 部署アラートが出る
#   開発部(u4:5)               … 重大度2は1件だけ（比率 0.2）→ 5段階中2。1人部署なので
#                                母数下限（仕様書 6.2）に満たず、アラートは出さない
#   管理部(u5:4 / u6:4)        … 計8件・重大度2が3件（比率 0.375）→ 5段階中3。2人部署なので
#                                こちらも母数下限に満たず、アラートは出さない
# 全員が3件以上受け取る。0件や1件の人がいると、その人に切り替えたデモで画面が動かない。
# 各人に応答済み（ack / dispute）と未応答を必ず混ぜる。
# days_ago はすべて保持期限（config の retention_days 既定30日）の内側に収める。
# 外に出すと、起動時のパージでデモデータが黙って消える。
# 本文は職場でありそうな範囲にとどめ、特定の人物を攻撃する文面にしない。
_DEMO_REPORTS: list[_DemoReport] = [
    # --- 営業部: u1 山田（メンバー）あて 4件 ---
    _DemoReport(23, "u3", "u1", "ignore", True, "ack", True,
                "共有のチャットで質問を投げても、返答がないまま話が進むことが続きました。"),
    _DemoReport(17, "u4", "u1", "interrupt", True, None, True,
                "打ち合わせで、説明している途中に結論を先に言われることがありました。"),
    _DemoReport(11, "u6", "u1", "exclude", True, "dispute", False,
                "担当している案件の変更が、共有されないまま先に進んでいました。"),
    _DemoReport(6, "u2", "u1", "stale_doc", True, None, False,
                "更新されていない資料のまま、内容の確認だけを求められました。"),
    # --- 営業部: u2 佐藤（部長）あて 6件。権力差のある相手ほど申告が集まる ---
    _DemoReport(26, "u3", "u2", "interrupt", True, "ack", True,
                "定例会議で、報告の途中で話を引き取られることが続きました。"),
    _DemoReport(22, "u1", "u2", "public_blame", True, "ack", True,
                "打ち合わせの場で、同じ指摘を人前で繰り返し受けました。"),
    _DemoReport(19, "u6", "u2", "rush", True, "dispute", True,
                "急ぎでない依頼でも、その日のうちの対応を求められ続けました。"),
    _DemoReport(14, "u3", "u2", "no_reason", True, None, True,
                "客先の担当を替えると伝えられましたが、理由の説明はありませんでした。"),
    _DemoReport(9, "u4", "u2", "overload", True, "ack", False,
                "期末の割り振りが特定の人に寄ったまま、見直しの話が出ませんでした。"),
    _DemoReport(5, "u1", "u2", "schedule", True, None, True,
                "前週に共有された予定と違う作業を、朝礼で当日に頼まれました。"),
    # --- 営業部: u3 鈴木（メンバー）あて 4件 ---
    _DemoReport(24, "u4", "u3", "public_blame", True, "ack", True,
                "他の人がいる場で、進め方の誤りを長い時間指摘されました。"),
    _DemoReport(16, "u2", "u3", "ignore", True, None, False,
                "相談の連絡に返信がないまま、期限だけが近づいたことがありました。"),
    _DemoReport(10, "u1", "u3", "exclude", True, "ack", True,
                "取引先への案内の内容が決まった場に呼ばれず、後から結果だけ聞きました。"),
    _DemoReport(7, "u4", "u3", "assign_without_ask", True, None, True,
                "定例の議事録の担当が、相談のないまま決まっていました。"),
    # --- 開発部: u4 高橋（メンバー）あて 5件 ---
    _DemoReport(25, "u1", "u4", "rush", True, "ack", True,
                "リリース前の相談が、毎回その日のうちの返答を求められる形でした。"),
    _DemoReport(20, "u2", "u4", "no_context", True, None, False,
                "依頼の連絡が一言だけで、何のための作業か分からないまま進めました。"),
    _DemoReport(15, "u3", "u4", "record", True, "dispute", False,
                "レビューの指摘が口頭だけで、記録に残らないことがありました。"),
    _DemoReport(12, "u6", "u4", "late_request", True, "ack", True,
                "確認の依頼が、期限の当日に届くことがありました。"),
    _DemoReport(8, "u1", "u4", "schedule", True, None, True,
                "打ち合わせの予定が、直前に取り消されることが続きました。"),
    # --- 管理部: u5 田中（役員）あて 4件 ---
    _DemoReport(21, "u4", "u5", "no_reason", True, "ack", True,
                "全社への連絡の内容が、担当者を通さずに変わっていることがありました。"),
    _DemoReport(13, "u1", "u5", "ignore", True, None, True,
                "相談の時間をお願いしても、返答がないまま予定が過ぎることが続きました。"),
    _DemoReport(9, "u3", "u5", "no_context", True, None, False,
                "方針の変更が短い連絡だけで伝わり、背景が分からないまま対応しました。"),
    _DemoReport(4, "u6", "u5", "late_request", True, "dispute", True,
                "資料の提出依頼が、締め切りの前日に届くことがありました。"),
    # --- 管理部: u6 伊藤（人事担当）あて 4件 ---
    _DemoReport(18, "u3", "u6", "privacy", True, "ack", True,
                "相談の内容に触れる話が、本人のいない場で出たことがありました。"),
    _DemoReport(14, "u1", "u6", "stale_doc", True, None, False,
                "手続きの案内が古いまま掲示されていて、差し戻しになりました。"),
    _DemoReport(10, "u4", "u6", "record", True, "ack", True,
                "問い合わせの回答が口頭だけで、後から確認できないことがありました。"),
    _DemoReport(5, "u2", "u6", "no_context", True, None, True,
                "申請の差し戻しの連絡に、どこを直せばよいかが書かれていませんでした。"),
    # --- 未配信 8件。管理者画面の「いま配信する」を押すデモに使う ---
    # いちばん古いものを12日前にして、「最古の未配信の待ち日数」が意味を持つようにする
    _DemoReport(12, "u3", "u2", "exclude", False, None, True,
                "共有されるはずの連絡が、こちらを外して回っていることがありました。"),
    _DemoReport(10, "u4", "u5", "overload", False, None, True,
                "対応できる範囲を超えた量の依頼が、続けて届いています。"),
    _DemoReport(9, "u1", "u4", "schedule", False, None, False,
                "予定表に無い打ち合わせが、当日に入ることがありました。"),
    _DemoReport(7, "u6", "u1", "late_request", False, None, True,
                "依頼の期限が、後から前倒しされることがありました。"),
    _DemoReport(5, "u2", "u6", "record", False, None, False,
                "決まったことが口頭だけで共有され、後から食い違うことがありました。"),
    _DemoReport(4, "u3", "u4", "no_context", False, None, True,
                "レビューの依頼に、どこを見てほしいかが書かれていませんでした。"),
    _DemoReport(2, "u1", "u2", "public_blame", False, None, True,
                "人前で長い時間、同じ指摘を受けることが続いています。"),
    _DemoReport(1, "u4", "u3", "stale_doc", False, None, False,
                "共有の手順書が古いまま、その通りに進めるよう求められました。"),
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
    for r in _DEMO_REPORTS:
        theme = _THEMES[r.theme]
        s.add(
            Report(
                id=str(uuid4()),
                author_id=r.author_id,
                target_id=r.target_id,
                severity=theme.severity,
                body=r.body,
                raw_body=r.body,
                has_context=r.has_context,
                status="delivered" if r.delivered else "pending",
                # 未配信の受信者向け文面は配信時に生成する（docs/api.md）。ここでは持たせない
                composed=(
                    {"what": r.body, "why": theme.why, "how": theme.how} if r.delivered else None
                ),
                response=r.response,
                created_at=now - timedelta(days=r.days_ago),
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
