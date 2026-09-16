"""アプリの組み立て。router と limiter の登録、起動時の保持期限パージ。"""

import asyncio
import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.middleware import SlowAPIMiddleware

from app.api.limits import limiter
from app.api.routes import router
from app.config import settings
from app.db.repositories import escalations as escalations_repo
from app.db.repositories import reports as reports_repo
from app.db.session import get_session, make_engine

logger = logging.getLogger(__name__)

_PURGE_INTERVAL_SECONDS = 60 * 60 * 24
"""保持期限のパージ間隔。起動時と1日1回（docs/api.md「保持期限」節）。"""


async def _purge_once() -> None:
    """reports と escalations を個別に try/except し、片方が失敗してももう片方は実行する。

    escalations は実名・原文を持つため、reports だけ消えた事実が黙って埋もれると気づけない。
    ログは件数と失敗の事実だけ。本文・author_id・鍵は出さない。
    """
    async for session in get_session():
        try:
            deleted_reports = await reports_repo.purge_old(session, settings.retention_days)
        except Exception:
            await session.rollback()
            logger.exception("保持期限切れの申告のパージに失敗しました")
        else:
            logger.info("保持期限切れの申告を %d 件パージしました", deleted_reports)

        try:
            deleted_escalations = await escalations_repo.purge_old(session, settings.retention_days)
        except Exception:
            await session.rollback()
            logger.exception("保持期限切れの引き継ぎのパージに失敗しました")
        else:
            logger.info("保持期限切れの引き継ぎを %d 件パージしました", deleted_escalations)


async def _purge_once_safely() -> None:
    """失敗しても呼び出し元（起動処理・ループ）を止めない _purge_once。

    マイグレーション未適用の DB に繋いだ直後の起動時など、保持期限の掃除自体が
    本質でない場面でサービスが上がらなくなるのを避ける。本文・author_id・鍵は出さない
    """
    try:
        await _purge_once()
    except Exception:
        logger.exception("保持期限のパージに失敗しました")


async def _purge_loop() -> None:
    while True:
        await asyncio.sleep(_PURGE_INTERVAL_SECONDS)
        await _purge_once_safely()


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    make_engine(settings.database_url)
    await _purge_once_safely()
    task = asyncio.create_task(_purge_loop())
    try:
        yield
    finally:
        task.cancel()


app = FastAPI(title="workplace-feedback-api", lifespan=lifespan)
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
app.add_middleware(SlowAPIMiddleware)
app.include_router(router)
