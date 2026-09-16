"""テーブル定義。列は docs/api.md の「データ」節どおり。

移植元: src/lib/store.ts の Report / Escalation。

SQLite（aiosqlite）でもテストを回せるよう、jsonb など Postgres 固有の型は使わず、
汎用の JSON / String を使う（composed は JSON、id は UUID 文字列を String(36) で持つ）。
"""

from datetime import UTC, datetime
from uuid import uuid4

from sqlalchemy import Boolean, DateTime, SmallInteger, String, Text
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column
from sqlalchemy.types import JSON


def _now() -> datetime:
    return datetime.now(UTC)


class Base(DeclarativeBase):
    pass


def _new_id() -> str:
    # 時刻を ID に含めない（時刻から送信タイミングが漏れると、まとめ配信の意味がなくなる）
    return str(uuid4())


class Report(Base):
    __tablename__ = "reports"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_new_id)
    author_id: Mapped[str] = mapped_column(String, nullable=False)
    """受信者向けの応答に出さない（docs/api.md）。"""
    target_id: Mapped[str] = mapped_column(String, nullable=False)
    severity: Mapped[int] = mapped_column(SmallInteger, nullable=False)
    body: Mapped[str] = mapped_column(Text, nullable=False)
    """送信者が確認した整理後の文面。"""
    raw_body: Mapped[str] = mapped_column(Text, nullable=False)
    """原文（仕様書 2.8）。受信者には出さない。"""
    has_context: Mapped[bool] = mapped_column(Boolean, nullable=False)
    status: Mapped[str] = mapped_column(String, nullable=False, default="pending")
    """"pending" | "delivered" """
    composed: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    response: Mapped[str | None] = mapped_column(String, nullable=True)
    """"ack" | "dispute" | None"""
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=_now
    )


class Escalation(Base):
    __tablename__ = "escalations"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_new_id)
    author_id: Mapped[str] = mapped_column(String, nullable=False)
    raw_body: Mapped[str] = mapped_column(Text, nullable=False)
    severity_reason: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=_now
    )
