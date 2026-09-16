"""HTTP ルーティング。docs/api.md のエンドポイントを1対1で実装する。

ロジックは持たない。domain / ai / db の関数を呼ぶだけで、例外を HTTP の状態コードに
変換するのがこの層の役目（ARCHITECTURE.md「決めごと」）。

ログに本文・author_id・鍵は出さない。
"""

import logging
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.ai.analyze import analyze
from app.ai.blur import blur
from app.ai.client import is_stub_mode
from app.ai.compose import compose
from app.api.limits import limiter
from app.db.repositories import escalations as escalations_repo
from app.db.repositories import inbox as inbox_repo
from app.db.repositories import reports as reports_repo
from app.db.session import get_session
from app.domain.rules import evaluate_depts
from app.domain.schemas import AdminView, Analysis, InboxItem
from app.domain.users import USERS

logger = logging.getLogger(__name__)

router = APIRouter()


# --- リクエスト/レスポンスの型（HTTP 層だけで使う DTO） ---


class HealthResponse(BaseModel):
    ok: bool = True


class MetaResponse(BaseModel):
    stub: bool


class AnalyzeRequest(BaseModel):
    me_id: str
    body: str


class BlurRequest(BaseModel):
    text: str


class BlurResponse(BaseModel):
    text: str


class ReportCreate(BaseModel):
    author_id: str
    target_id: str
    severity: Literal[1, 2, 3]
    body: str
    raw_body: str
    has_context: bool


class ResponseCreate(BaseModel):
    kind: Literal["ack", "dispute"]


class EscalationCreate(BaseModel):
    author_id: str
    raw_body: str
    severity_reason: str


class IdResponse(BaseModel):
    id: str


# --- ヘルス/メタ ---


@router.get("/health", response_model=HealthResponse)
async def health() -> HealthResponse:
    return HealthResponse(ok=True)


@router.get("/meta", response_model=MetaResponse)
async def meta() -> MetaResponse:
    return MetaResponse(stub=is_stub_mode())


# --- AI ---


@router.post("/analyze", response_model=Analysis)
@limiter.limit("20/minute")
async def analyze_endpoint(request: Request, payload: AnalyzeRequest) -> Analysis:
    candidate_names = [u.name for u in USERS if u.id != payload.me_id]
    try:
        return await analyze(payload.body, candidate_names)
    except Exception as exc:
        logger.exception("analyze に失敗しました")
        raise HTTPException(
            status_code=502, detail="解析に失敗しました。もう一度お試しください。"
        ) from exc


@router.post("/blur", response_model=BlurResponse)
@limiter.limit("20/minute")
async def blur_endpoint(request: Request, payload: BlurRequest) -> BlurResponse:
    try:
        blurred = await blur(payload.text)
    except Exception as exc:
        logger.exception("blur に失敗しました")
        raise HTTPException(status_code=502, detail="書き直しに失敗しました。") from exc
    return BlurResponse(text=blurred)


# --- 申告（reports） ---


@router.post("/reports", status_code=201, response_model=IdResponse)
@limiter.limit("10/minute")
async def create_report(
    request: Request,
    payload: ReportCreate,
    session: AsyncSession = Depends(get_session),  # noqa: B008
) -> IdResponse:
    # レベル3はこのツールで扱わない。UI で止めているが、サーバー側でも拒否する。
    if payload.severity == 3:
        raise HTTPException(
            status_code=422, detail="この内容はこのツールでは送信できません。"
        )
    report_id = await reports_repo.add_report(
        session,
        author_id=payload.author_id,
        target_id=payload.target_id,
        severity=payload.severity,
        body=payload.body,
        raw_body=payload.raw_body,
        has_context=payload.has_context,
    )
    return IdResponse(id=report_id)


@router.delete("/reports/{report_id}", status_code=204)
async def cancel_report(
    report_id: str,
    author_id: str,
    session: AsyncSession = Depends(get_session),  # noqa: B008
) -> None:
    ok = await reports_repo.cancel_report(session, report_id, author_id)
    if not ok:
        raise HTTPException(
            status_code=409, detail="すでに配信されたため取り消せません。"
        )


@router.get("/inbox/{user_id}", response_model=list[InboxItem])
async def get_inbox(
    user_id: str, session: AsyncSession = Depends(get_session)  # noqa: B008
) -> list[InboxItem]:
    return await inbox_repo.list_inbox(session, user_id)


@router.post("/reports/{report_id}/response", status_code=204)
async def respond_to_report(
    report_id: str,
    payload: ResponseCreate,
    session: AsyncSession = Depends(get_session),  # noqa: B008
) -> None:
    await reports_repo.set_response(session, report_id, payload.kind)


# --- 人事への引き継ぎ（escalations） ---


@router.post("/escalations", status_code=201, response_model=IdResponse)
@limiter.limit("10/minute")
async def create_escalation(
    request: Request,
    payload: EscalationCreate,
    session: AsyncSession = Depends(get_session),  # noqa: B008
) -> IdResponse:
    escalation_id = await escalations_repo.add_escalation(
        session,
        author_id=payload.author_id,
        raw_body=payload.raw_body,
        severity_reason=payload.severity_reason,
    )
    return IdResponse(id=escalation_id)


# --- 管理画面 ---


async def _admin_view(session: AsyncSession) -> AdminView:
    pending = await reports_repo.pending_count(session)
    delivered = await reports_repo.list_delivered_for_eval(session)
    escalations = await escalations_repo.list_escalations(session)
    return AdminView(pending=pending, depts=evaluate_depts(delivered), escalations=escalations)


@router.get("/admin", response_model=AdminView)
async def get_admin(session: AsyncSession = Depends(get_session)) -> AdminView:  # noqa: B008
    return await _admin_view(session)


@router.post("/admin/deliver", response_model=AdminView)
async def deliver(session: AsyncSession = Depends(get_session)) -> AdminView:  # noqa: B008
    """まとめ配信。未配信を全部配信する。

    受信者向け文面（composed）はここで生成する。生成に失敗した件は composed=None の
    まま配信済みにする（現行の src/app/actions.ts deliverAction と同じ挙動）。
    """
    batch = await reports_repo.list_pending(session)
    for r in batch:
        composed = None
        try:
            composed = await compose(r.body)
        except Exception:
            logger.exception("compose に失敗しました")
        await reports_repo.mark_delivered(
            session, r.id, composed.model_dump() if composed is not None else None
        )
    return await _admin_view(session)


@router.post("/admin/reset", status_code=204)
async def reset(session: AsyncSession = Depends(get_session)) -> None:  # noqa: B008
    await reports_repo.reset_to_seed(session)
