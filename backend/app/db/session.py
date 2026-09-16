"""非同期エンジンとセッション。

起動時に main.py が make_engine(settings.database_url) を呼ぶ想定。
get_session は FastAPI の依存性として使うほか、未初期化なら DATABASE_URL 環境変数から
遅延初期化する（テストや `python -c` での動作確認用）。
"""

import os
from collections.abc import AsyncIterator

from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

SessionFactory = async_sessionmaker[AsyncSession]

_engine: AsyncEngine | None = None
_session_factory: SessionFactory | None = None


def make_engine(url: str) -> AsyncEngine:
    global _engine, _session_factory
    _engine = create_async_engine(url, pool_pre_ping=True)
    _session_factory = async_sessionmaker(_engine, expire_on_commit=False)
    return _engine


async def get_session() -> AsyncIterator[AsyncSession]:
    if _session_factory is None:
        make_engine(os.environ["DATABASE_URL"])
    assert _session_factory is not None
    async with _session_factory() as session:
        yield session
