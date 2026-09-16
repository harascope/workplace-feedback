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
