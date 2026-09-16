"""pytest 共通フィクスチャ。

DATABASE_URL / GEMINI_API_KEY は、app.* を import する前に確定させる必要がある
（app.config.Settings は import 時点で環境変数を読む）。実 API は絶対に呼ばない。
"""

import os

os.environ.setdefault("DATABASE_URL", "sqlite+aiosqlite://")
os.environ.pop("GEMINI_API_KEY", None)

from collections.abc import AsyncIterator

import httpx
import pytest
import pytest_asyncio
from sqlalchemy import event
from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.pool import StaticPool

from app.db.models import Base

DbEngine = tuple[AsyncEngine, async_sessionmaker[AsyncSession]]


async def _make_engine_and_factory() -> DbEngine:
    """テストごとに作り直す SQLite（aiosqlite）。StaticPool で単一コネクションを共有する。"""
    engine = create_async_engine(
        "sqlite+aiosqlite://",
        poolclass=StaticPool,
        connect_args={"check_same_thread": False},
    )
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    factory = async_sessionmaker(engine, expire_on_commit=False)
    return engine, factory


@pytest_asyncio.fixture
async def db_engine() -> AsyncIterator[DbEngine]:
    engine, factory = await _make_engine_and_factory()
    yield engine, factory
    await engine.dispose()


@pytest_asyncio.fixture
async def db_session(db_engine: DbEngine) -> AsyncIterator[AsyncSession]:
    _engine, factory = db_engine
    async with factory() as session:
        yield session


@pytest.fixture
def sql_capture(db_engine: DbEngine) -> AsyncIterator[list[str]]:
    """発行された SQL 文を集める。受信箱クエリの author_id / raw_body 非選択を確認するため。"""
    engine, _factory = db_engine
    statements: list[str] = []

    def _listener(conn, cursor, statement, parameters, context, executemany):  # noqa: ANN001
        statements.append(statement)

    event.listen(engine.sync_engine, "before_cursor_execute", _listener)
    yield statements
    event.remove(engine.sync_engine, "before_cursor_execute", _listener)


@pytest.fixture(autouse=True)
def _reset_rate_limiter() -> None:
    """slowapi の Limiter はプロセス内で共有される状態を持つ。テスト間で持ち越さない。"""
    from app.api.limits import limiter

    limiter.reset()


@pytest_asyncio.fixture
async def client(db_engine: DbEngine) -> AsyncIterator[httpx.AsyncClient]:
    """app/api を通した httpx クライアント。get_session を差し替え、lifespan は起動しない。"""
    from app.db.session import get_session
    from app.main import app

    _engine, factory = db_engine

    async def _override_get_session() -> AsyncIterator[AsyncSession]:
        async with factory() as session:
            yield session

    app.dependency_overrides[get_session] = _override_get_session
    transport = httpx.ASGITransport(app=app)
    try:
        async with httpx.AsyncClient(transport=transport, base_url="http://test") as ac:
            yield ac
    finally:
        app.dependency_overrides.clear()
