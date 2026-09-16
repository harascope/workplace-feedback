"""ドメインの型。Pydantic v2。他の層はここを import する。

移植元: src/lib/ai/schemas.ts（Analysis / Composed）
src/app/actions.ts（InboxItem / DeptEval / EscalationView / AdminView）
"""

from datetime import datetime
from typing import Literal

from pydantic import BaseModel


class Action(BaseModel):
    description: str
    """相手が「した」こと。書き手の言葉をできるだけ残す。"""
    observable: bool
    """外から観察できるか。できないもの（態度が悪い等）は相手が認知できない。"""


class Analysis(BaseModel):
    actions: list[Action]
    context: str | None
    target_hint: str | None
    severity: Literal[1, 2, 3]
    severity_reason: str
    identifiability: Literal["low", "medium", "high"]
    rephrase_hint: str | None = None
    """actions が空で、身体的特徴・人格など行動でない何かに触れている場合の言い換え案。
    AI が actions を勝手に埋めることはしない（人格攻撃がそのまま通る経路になるため）。
    ここは案の提示だけで、書き直すかどうかは送信者が選ぶ。本当に何も書かれていない
    入力（なんかつらい等）では null のまま。"""
    identifiability_reason: str
    organized: str
    """送信者が書いた内容を、相手が読む形に整えた文面。"""


class Composed(BaseModel):
    what: str
    """何が指摘されているか（送信者の記述）。"""
    why: str
    """なぜ問題になりうるか（AI）。"""
    how: str
    """一般的な対応の方向（AI）。送信者の要望として書かない。"""


class InboxItem(BaseModel):
    """受信者向けの read model。author_id・raw_body を含めない（仕様書 2.8）。"""

    id: str
    body: str
    has_context: bool
    composed: Composed | None
    response: Literal["ack", "dispute"] | None


class DeptEval(BaseModel):
    """部署ごとの独立評価（仕様書 6.1）。申告ゼロなら level は None、label は「データなし」。"""

    dept: str
    level: int | None
    label: str
    detail: str
    member_count: int = 0
    """在籍人数。母数下限の説明に使う。申告の件数ではない。"""
    below_min_members: bool = False
    """母数下限に満たないか（仕様書 6.2）。満たないなら部署単位のアラートを出さない。"""
    alert: bool = False
    """部署アラートが出ているか（仕様書 6.2）。件数は出さない。"""


class SeverityMix(BaseModel):
    """配信済みの重大度の内訳（全社の合計のみ）。部署 × 重大度の表は作らない。"""

    level1: int
    level2: int


class DeliveryStatus(BaseModel):
    """まとめ配信の状態（仕様書 5.1）。即時配信はしないので、次がいつかを管理者に示す。"""

    next_at: datetime
    interval_days: int
    oldest_pending_days: int | None
    """いちばん古い未配信が待っている日数。未配信が無ければ None。"""
    delivered_total: int


class EscalationView(BaseModel):
    id: str
    author_name: str
    raw_body: str
    severity_reason: str
    created_at: datetime


class AdminView(BaseModel):
    pending: int
    depts: list[DeptEval]
    escalations: list[EscalationView]
    severity_mix: SeverityMix
    delivery: DeliveryStatus
    level_max: int
    """部署評価の段階数。5 が最も危険（仕様書 6.1）。"""
    dept_alert_min_members: int
    """部署アラートを出す母数の下限（仕様書 6.2）。"""
