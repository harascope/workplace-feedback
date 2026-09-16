"""管理者向けの集計規則（仕様書 6.1 / 6.2）と、まとめ配信の周期（仕様書 5.1）。

移植元: src/lib/store.ts の evaluateDepts。

ここは純粋なロジックだけを置く。DB も HTTP も知らない。
"""

import math
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta, timezone

from app.domain.schemas import DeptEval, SeverityMix
from app.domain.users import USERS

LEVEL_MAX = 5
"""部署評価の段階数。5 が最も危険（仕様書 6.1）。"""

DEPT_ALERT_MIN_MEMBERS = 3
"""部署アラートを出す母数の下限（仕様書 6.2「母数下限」）。

仕様では具体値が【要決定】（7.1）。デモの名簿が 6 人（営業部3・開発部1・管理部2）なので、
settings.ts の既定値 5 のままだとどの部署も下限に届かず、集計が常に一段上（全社）に寄って
しまう。ここでは 3 を暫定値として置く。下限未満の部署は「まだ判断できない」として扱い、
部署単位のアラートを出さない。
"""

DEPT_ALERT_MIN_AUTHORS = 2
"""部署アラートに要る「異なる申告者」の数（仕様書 3.3 の人数ベース閾値に合わせる）。

回数ベースにすると一人が繰り返し送っただけで発火するため、必ず人数で数える。
"""

DELIVERY_INTERVAL_DAYS = 7
"""まとめ配信の間隔。既定は週1（仕様書 5.1）。"""

_JST = timezone(timedelta(hours=9))
_DELIVERY_WEEKDAY = 0
"""月曜。datetime.weekday() は月曜が 0。"""
_DELIVERY_HOUR = 9


@dataclass(frozen=True)
class DeliveredReport:
    """集計に要る列だけ。

    author_id は「異なる申告者の数」を数えるためだけに使う。**管理者には出さない**
    （誰が送ったかは渡さない。仕様書 3.3）。既定値を持たせてあるのは、
    申告者を数えない呼び出し側が同一人物として畳まれ、アラートが誤発火しない側に倒れるため。
    """

    target_id: str
    severity: int
    author_id: str = ""


def next_delivery_at(now: datetime) -> datetime:
    """次のまとめ配信の時刻（毎週月曜 9:00 JST）を UTC で返す（仕様書 5.1）。

    即時配信はしないので、管理者が「次はいつ届くか」を見られるようにする。
    ちょうど配信時刻のときは、その回は済んだものとして次の週を返す。
    """
    local = now.astimezone(_JST)
    at = local.replace(hour=_DELIVERY_HOUR, minute=0, second=0, microsecond=0)
    at += timedelta(days=(_DELIVERY_WEEKDAY - local.weekday()) % 7)
    if at <= local:
        at += timedelta(days=7)
    return at.astimezone(UTC)


def severity_mix(delivered: Sequence[DeliveredReport]) -> SeverityMix:
    """配信済みの重大度の内訳。**全社の合計のみ**（仕様書 6.1 / 6.2）。

    部署 × 重大度の表は作らない。小規模組織では、その粒度まで出すと
    「どの部署の誰が、どれくらい重いことを書いたか」に近づき、申告者の特定につながるため。
    レベル3は申告として保存しない（送信を止めて人事引き継ぎに回す。仕様書 3.1）ので、
    ここには現れない。
    """
    return SeverityMix(
        level1=sum(1 for r in delivered if r.severity == 1),
        level2=sum(1 for r in delivered if r.severity >= 2),
    )


def evaluate_depts(delivered: Sequence[DeliveredReport]) -> list[DeptEval]:
    """部署ごとの独立評価を作る（仕様書 6.1）。ランキングにはしない。

    呼び出し側は配信済みの申告だけを渡すこと（時期ぼかし）。申告ゼロの部署は
    level None・label「データなし」。申告が1件だけの部署は detail に集中・分散を付けない。
    """
    depts = list(dict.fromkeys(u.dept for u in USERS))
    result: list[DeptEval] = []

    for dept in depts:
        members = {u.id for u in USERS if u.dept == dept}
        rs = [r for r in delivered if r.target_id in members]
        # 母数下限（仕様書 6.2）。人数が少ない単位で発火させると、誰が書いていないかを
        # 探す動きを誘発する。下限未満なら部署単位では判断しない
        below_min_members = len(members) < DEPT_ALERT_MIN_MEMBERS

        if not rs:
            result.append(
                DeptEval(
                    dept=dept,
                    level=None,
                    label="データなし",
                    detail="申告がありません",
                    member_count=len(members),
                    below_min_members=below_min_members,
                    alert=False,
                )
            )
            continue

        heavy = sum(1 for r in rs if r.severity >= 2)
        ratio = heavy / len(rs)
        targets = {r.target_id for r in rs}
        # Math.round 相当（非負値のみを扱うため floor(x + 0.5) で足りる。銀行丸めは使わない）
        level = min(5, 1 + math.floor(ratio * 2 + 0.5) + (1 if len(rs) >= 2 else 0))
        # 1件だけでは集中か分散かを言えないので、何も付けない
        if len(rs) == 1:
            concentration = ""
        elif len(targets) == 1:
            concentration = " ・ 特定の1名に集中"
        else:
            concentration = " ・ 複数名に分散"

        # 部署アラート（仕様書 6.2）。個人の問題ではなく組織の問題として扱う条件に絞る:
        #   - 母数下限を満たす
        #   - 異なる申告者が閾値以上（回数ではなく人数。仕様書 3.3）
        #   - 申告が複数名に分散している（1人に集まっているなら個人の問題。仕様書 6.1 の集中度）
        alert = (
            not below_min_members
            and len({r.author_id for r in rs}) >= DEPT_ALERT_MIN_AUTHORS
            and len(targets) >= 2
        )

        result.append(
            DeptEval(
                dept=dept,
                level=level,
                # 「レベル N」とは書かない。このアプリでは「レベル」は申告の重大度（仕様書 3.1）を
                # 指す語で、送信画面の「レベル3＝このツールでは扱えない」と同じ表記にすると、
                # 管理者が「営業部にレベル3の案件がある」と読み違える。部署評価は別の軸なので
                # 「5 段階中 N」と書いて取り違えを防ぐ
                label=f"{LEVEL_MAX} 段階中 {level}",
                detail=f"重大度2以上が {heavy}/{len(rs)}{concentration}",
                member_count=len(members),
                below_min_members=below_min_members,
                alert=alert,
            )
        )

    return result
