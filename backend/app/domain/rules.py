"""部署評価（仕様書 6.1）。

移植元: src/lib/store.ts の evaluateDepts。
"""

import math
from collections.abc import Sequence
from dataclasses import dataclass

from app.domain.schemas import DeptEval
from app.domain.users import USERS


@dataclass(frozen=True)
class DeliveredReport:
    """集計に要る列だけ。"""

    target_id: str
    severity: int


def evaluate_depts(delivered: Sequence[DeliveredReport]) -> list[DeptEval]:
    """部署ごとの独立評価を作る。

    呼び出し側は配信済みの申告だけを渡すこと（時期ぼかし）。申告ゼロの部署は
    level None・label「データなし」。申告が1件だけの部署は detail に集中・分散を付けない。
    """
    depts = list(dict.fromkeys(u.dept for u in USERS))
    result: list[DeptEval] = []

    for dept in depts:
        members = {u.id for u in USERS if u.dept == dept}
        rs = [r for r in delivered if r.target_id in members]

        if not rs:
            result.append(
                DeptEval(dept=dept, level=None, label="データなし", detail="申告がありません")
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

        result.append(
            DeptEval(
                dept=dept,
                level=level,
                label=f"レベル {level}",
                detail=f"重大度2以上が {heavy}/{len(rs)}{concentration}",
            )
        )

    return result
