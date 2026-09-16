"""app/api の HTTP 契約テスト（docs/api.md）。httpx + ASGITransport。実 API は呼ばない。"""

import httpx
import pytest


class TestHealthAndMeta:
    async def test_health(self, client: httpx.AsyncClient) -> None:
        r = await client.get("/health")
        assert r.status_code == 200
        assert r.json() == {"ok": True}

    async def test_meta_reports_stub_mode(self, client: httpx.AsyncClient) -> None:
        # conftest で GEMINI_API_KEY を未設定にしているので stub=True
        r = await client.get("/meta")
        assert r.status_code == 200
        assert r.json() == {"stub": True}


class TestAnalyzeAndBlur:
    async def test_analyze_returns_200(self, client: httpx.AsyncClient) -> None:
        r = await client.post("/analyze", json={"me_id": "u1", "body": "会議で発言を遮られた"})
        assert r.status_code == 200
        body = r.json()
        assert body["severity"] in (1, 2, 3)

    async def test_blur_returns_200(self, client: httpx.AsyncClient) -> None:
        r = await client.post("/blur", json={"text": "1on1で言われた"})
        assert r.status_code == 200
        assert isinstance(r.json()["text"], str)

    async def test_analyze_failure_is_502_with_exact_message(
        self, client: httpx.AsyncClient, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        async def _boom(*args, **kwargs):  # noqa: ANN002, ANN003
            raise RuntimeError("落ちた")

        monkeypatch.setattr("app.api.routes.analyze", _boom)

        r = await client.post("/analyze", json={"me_id": "u1", "body": "何か"})

        assert r.status_code == 502
        assert r.json() == {"detail": "解析に失敗しました。もう一度お試しください。"}


class TestReportsCreateAndCancel:
    async def test_severity_3_is_rejected(self, client: httpx.AsyncClient) -> None:
        r = await client.post(
            "/reports",
            json={
                "author_id": "u1",
                "target_id": "u2",
                "severity": 3,
                "body": "…",
                "raw_body": "…",
                "has_context": True,
            },
        )

        assert r.status_code == 422
        assert r.json() == {"detail": "この内容はこのツールでは送信できません。"}

    async def test_valid_report_is_created(self, client: httpx.AsyncClient) -> None:
        r = await client.post(
            "/reports",
            json={
                "author_id": "u1",
                "target_id": "u2",
                "severity": 1,
                "body": "整理後の文面",
                "raw_body": "原文",
                "has_context": True,
            },
        )

        assert r.status_code == 201
        assert isinstance(r.json()["id"], str) and r.json()["id"]

    async def test_owner_can_cancel_while_pending(self, client: httpx.AsyncClient) -> None:
        created = await client.post(
            "/reports",
            json={
                "author_id": "u1",
                "target_id": "u2",
                "severity": 1,
                "body": "…",
                "raw_body": "…",
                "has_context": True,
            },
        )
        report_id = created.json()["id"]

        r = await client.delete(f"/reports/{report_id}", params={"author_id": "u1"})

        assert r.status_code == 204

    async def test_cannot_cancel_after_delivery(self, client: httpx.AsyncClient) -> None:
        created = await client.post(
            "/reports",
            json={
                "author_id": "u1",
                "target_id": "u2",
                "severity": 1,
                "body": "…",
                "raw_body": "…",
                "has_context": True,
            },
        )
        report_id = created.json()["id"]
        await client.post("/admin/deliver")

        r = await client.delete(f"/reports/{report_id}", params={"author_id": "u1"})

        assert r.status_code == 409
        assert r.json() == {"detail": "すでに配信されたため取り消せません。"}


class TestInboxDoesNotLeakAuthorOrRawBody:
    async def test_inbox_response_never_contains_author_id_or_raw_body(
        self, client: httpx.AsyncClient
    ) -> None:
        secret_raw_body = "これは絶対に受信者へ見せてはいけない原文トークンXYZ"
        created = await client.post(
            "/reports",
            json={
                "author_id": "u1",
                "target_id": "u2",
                "severity": 1,
                "body": "整理後の文面",
                "raw_body": secret_raw_body,
                "has_context": True,
            },
        )
        assert created.status_code == 201
        await client.post("/admin/deliver")

        r = await client.get("/inbox/u2")

        assert r.status_code == 200
        assert "author_id" not in r.text
        assert "raw_body" not in r.text
        assert secret_raw_body not in r.text
        assert "u1" not in r.text  # author_id の値そのものも出てはいけない


class TestResponseEscalationsAdmin:
    async def test_respond_to_report(self, client: httpx.AsyncClient) -> None:
        created = await client.post(
            "/reports",
            json={
                "author_id": "u1",
                "target_id": "u2",
                "severity": 1,
                "body": "…",
                "raw_body": "…",
                "has_context": True,
            },
        )
        report_id = created.json()["id"]
        await client.post("/admin/deliver")

        r = await client.post(f"/reports/{report_id}/response", json={"kind": "ack"})

        assert r.status_code == 204

    async def test_escalations_create(self, client: httpx.AsyncClient) -> None:
        r = await client.post(
            "/escalations",
            json={"author_id": "u3", "raw_body": "上司に殴られた", "severity_reason": "暴力"},
        )

        assert r.status_code == 201
        assert isinstance(r.json()["id"], str) and r.json()["id"]

    async def test_admin_and_deliver_and_reset(self, client: httpx.AsyncClient) -> None:
        r = await client.get("/admin")
        assert r.status_code == 200
        assert "pending" in r.json()

        r = await client.post("/admin/deliver")
        assert r.status_code == 200

        r = await client.post("/admin/reset")
        assert r.status_code == 204


class TestRateLimit:
    async def test_reports_rate_limit_returns_429(self, client: httpx.AsyncClient) -> None:
        # docs/api.md: POST /reports は 10/分。11回目で 429 になる
        payload = {
            "author_id": "u1",
            "target_id": "u2",
            "severity": 1,
            "body": "…",
            "raw_body": "…",
            "has_context": True,
        }
        statuses = [(await client.post("/reports", json=payload)).status_code for _ in range(11)]

        assert statuses[:10] == [201] * 10
        assert statuses[10] == 429
