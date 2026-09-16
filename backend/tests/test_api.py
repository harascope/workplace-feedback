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

    async def test_unknown_report_does_not_claim_it_was_delivered(
        self, client: httpx.AsyncClient
    ) -> None:
        # 配信していないのに「すでに配信された」と出すと、送信者は相手に届いたと誤解する
        r = await client.delete("/reports/存在しないid", params={"author_id": "u1"})

        assert r.status_code == 409
        assert r.json() == {
            "detail": "取り消せませんでした。すでに配信されたか、この送信が見つかりません。"
        }

    async def test_non_owner_gets_the_non_committal_message(
        self, client: httpx.AsyncClient
    ) -> None:
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

        r = await client.delete(f"/reports/{report_id}", params={"author_id": "u3"})

        assert r.status_code == 409
        assert r.json() == {
            "detail": "取り消せませんでした。すでに配信されたか、この送信が見つかりません。"
        }


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

    async def test_admin_view_carries_the_dashboard_fields(
        self, client: httpx.AsyncClient
    ) -> None:
        body = (await client.get("/admin")).json()

        assert body["level_max"] == 5
        assert body["dept_alert_min_members"] == 3
        assert body["severity_mix"] == {"level1": 0, "level2": 0}
        assert body["delivery"]["interval_days"] == 7
        assert body["delivery"]["oldest_pending_days"] is None
        assert body["delivery"]["delivered_total"] == 0
        assert isinstance(body["delivery"]["next_at"], str)
        # 部署評価には在籍人数と母数下限の判定が乗る（仕様書 6.2）
        dept = next(d for d in body["depts"] if d["dept"] == "営業部")
        assert dept["member_count"] == 3
        assert dept["below_min_members"] is False
        assert dept["alert"] is False


class TestAdminReset:
    async def test_reset_keeps_the_seed_counts(self, client: httpx.AsyncClient) -> None:
        # 配信済み1件・未配信1件・引き継ぎ0件。E2E がこの数に依存している
        await client.post("/admin/seed-demo")

        await client.post("/admin/reset")

        body = (await client.get("/admin")).json()
        assert body["pending"] == 1
        assert body["delivery"]["delivered_total"] == 1
        assert body["escalations"] == []


class TestAdminSeedDemo:
    async def test_seed_demo_returns_a_populated_admin_view(
        self, client: httpx.AsyncClient
    ) -> None:
        r = await client.post("/admin/seed-demo")

        assert r.status_code == 200
        body = r.json()
        assert body["pending"] > 0
        assert body["delivery"]["delivered_total"] > 0
        assert body["delivery"]["oldest_pending_days"] is not None
        assert body["severity_mix"]["level1"] > 0
        assert body["severity_mix"]["level2"] > 0
        assert len(body["escalations"]) == 2

        depts = {d["dept"]: d for d in body["depts"]}
        # 営業部は複数名から分散して届いているので部署アラートが出る（仕様書 6.2）
        assert depts["営業部"]["alert"] is True
        # 開発部は1人部署なので母数下限に満たず、アラートは出さない
        assert depts["開発部"]["below_min_members"] is True
        assert depts["開発部"]["alert"] is False
        # 管理部にも配信済みが届くので「データなし」にはならない（仕様書 6.1 の「データなし」は
        # 申告ゼロのときの表示）。ただし2人部署なので母数下限に満たず、部署単位では判断しない
        # （仕様書 6.2）。評価自体は出るがアラートは出さない、が正しい状態
        assert depts["管理部"]["level"] is not None
        assert depts["管理部"]["label"] != "データなし"
        assert depts["管理部"]["below_min_members"] is True
        assert depts["管理部"]["alert"] is False

    async def test_seed_demo_never_exposes_author_ids(
        self, client: httpx.AsyncClient
    ) -> None:
        # 管理者にも申告者は渡さない。実名が出てよいのは本人が同意した引き継ぎだけ
        r = await client.post("/admin/seed-demo")

        assert "author_id" not in r.text


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

    async def test_rate_limit_is_keyed_per_x_client_id_header(
        self, client: httpx.AsyncClient
    ) -> None:
        # X-Client-Id が別なら別枠で数える（web はここに利用者を識別する値を載せる。docs/api.md）
        payload = {
            "author_id": "u1",
            "target_id": "u2",
            "severity": 1,
            "body": "…",
            "raw_body": "…",
            "has_context": True,
        }
        for _ in range(10):
            r = await client.post("/reports", json=payload, headers={"X-Client-Id": "client-a"})
            assert r.status_code == 201

        # client-a は使い切ったが client-b は別枠なのでまだ通る
        r = await client.post("/reports", json=payload, headers={"X-Client-Id": "client-a"})
        assert r.status_code == 429

        r = await client.post("/reports", json=payload, headers={"X-Client-Id": "client-b"})
        assert r.status_code == 201

    async def test_admin_write_endpoints_match_the_documented_limits(
        self, client: httpx.AsyncClient
    ) -> None:
        # docs/api.md「レート制限」の表と1対1。上限ちょうどまで通り、その次で 429 になる
        for path, limit, ok in (
            ("/admin/deliver", 12, 200),
            ("/admin/reset", 20, 204),
            ("/admin/seed-demo", 6, 200),
        ):
            statuses = [(await client.post(path)).status_code for _ in range(limit + 1)]

            assert statuses[:limit] == [ok] * limit, path
            assert statuses[limit] == 429, path

    async def test_admin_reset_survives_one_e2e_round(self, client: httpx.AsyncClient) -> None:
        # E2E は8テストとも beforeEach で resetDemo() を呼ぶ（e2e/helpers.ts）。
        # CI は retries: 1 なので最悪16回。上限がこれを下回ると E2E が 429 で落ちる
        statuses = [(await client.post("/admin/reset")).status_code for _ in range(16)]

        assert statuses == [204] * 16

    async def test_admin_rate_limit_is_keyed_per_x_client_id_header(
        self, client: httpx.AsyncClient
    ) -> None:
        # 管理系も /reports と同じキーで数える。回数の少ない seed-demo（6/分）で確かめる
        for _ in range(6):
            r = await client.post("/admin/seed-demo", headers={"X-Client-Id": "admin-a"})
            assert r.status_code == 200

        # admin-a は使い切ったが admin-b は別枠なのでまだ通る
        r = await client.post("/admin/seed-demo", headers={"X-Client-Id": "admin-a"})
        assert r.status_code == 429

        r = await client.post("/admin/seed-demo", headers={"X-Client-Id": "admin-b"})
        assert r.status_code == 200
