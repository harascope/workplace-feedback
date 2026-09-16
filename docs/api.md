# API 仕様書（web ⇄ api）

Next.js（web）と FastAPI（api）の間の契約。**この文書が唯一の拠り所**で、実装側が勝手に変えない。
api は外部公開しない。ブラウザは web にだけ触れ、web の Server Actions が api を呼ぶ。

- ベース URL: `API_BASE_URL`（既定 `http://api:8000`）
- 形式: JSON、**snake_case**
- 認証: 無し（内部ネットワークのみ）
- 文字コード: UTF-8

## エンドポイント

### `GET /health`
死活確認（Docker の healthcheck 用）。
```json
{ "ok": true }
```

### `GET /meta`
```json
{ "stub": true }
```
`stub` は `GEMINI_API_KEY` 未設定のとき true。画面上部の「スタブ動作中」表示に使う。

### `POST /analyze`
```json
// req
{ "me_id": "u3", "body": "先週の定例会議で…" }
// res 200
{
  "actions": [{ "description": "発言を遮って話し始めた", "observable": true }],
  "context": "先週の定例会議",
  "target_hint": "佐藤部長",
  "severity": 1,
  "severity_reason": "単発の言動と読める",
  "identifiability": "low",
  "identifiability_reason": "…",
  "organized": "先週の定例会議にて、発言を遮って話し始めました。"
}
```
- `severity`: `1 | 2 | 3`
- `identifiability`: `"low" | "medium" | "high"`
- `context` と `target_hint` は null になりうる
- 失敗時 502（AI 呼び出しが3回とも失敗）

### `POST /blur`
```json
// req
{ "text": "…" }
// res 200
{ "text": "…（特定されにくい表現）" }
```

### `POST /reports`
```json
// req
{ "author_id": "u3", "target_id": "u2", "severity": 2,
  "body": "整理後の文面", "raw_body": "書いた本人の原文", "has_context": true }
// res 201
{ "id": "3f7c…" }
```
- **`severity` が 3 なら 422**（このツールでは扱わない。UI でも止めるがサーバーでも拒否する）
- `raw_body` は保存するが、受信者には決して返さない（仕様書 2.8）

### `DELETE /reports/{id}?author_id=u3`
- 204: 取り消した
- 409: 本人でない、配信済み、存在しない

### `GET /inbox/{user_id}`
```json
[
  { "id": "3f7c…", "body": "…", "has_context": true,
    "composed": { "what": "…", "why": "…", "how": "…" }, "response": null }
]
```
- **`author_id` と `raw_body` を含めない。** 受信者向けの read model を別に定義し、クエリでその列を select しない
- 配信済み（`status = "delivered"`）だけを返す
- `response`: `"ack" | "dispute" | null`

### `POST /reports/{id}/response`
```json
// req
{ "kind": "ack" }
```
- 204。`kind` は `"ack" | "dispute"`

### `GET /admin` / `POST /admin/deliver`
```json
{
  "pending": 1,
  "depts": [{ "dept": "営業部", "level": 3, "label": "レベル 3", "detail": "重大度2以上が 1/1" }],
  "escalations": [{ "id": "…", "author_name": "鈴木 花子", "raw_body": "…",
                    "severity_reason": "暴力・脅迫等に該当しうる", "created_at": "2026-09-16T01:00:00Z" }]
}
```
- `deliver` は未配信を全部配信し、そのとき受信者向け文面（`composed`）を生成する。生成に失敗した件は `composed: null` のまま配信済みにする
- `depts[].level` は申告ゼロなら `null`、`label` は `"データなし"`
- **配信済みの申告だけを集計する**（時期ぼかし）。申告が1件だけの部署は `detail` に集中・分散を付けない

### `POST /escalations`
```json
// req
{ "author_id": "u3", "raw_body": "…", "severity_reason": "暴力・脅迫等に該当しうる" }
// res 201
{ "id": "…" }
```
- 本人が同意したときだけ呼ばれる。受信箱にも部署評価にも混ぜない

### `POST /admin/reset`
- 204。シード状態（配信済み1件・未配信1件・引き継ぎ0件）に戻す。デモ用

## エラー

| 状況 | 状態コード | 本文 |
|---|---|---|
| 入力が不正 | 422 | FastAPI 既定 |
| 重大度3の送信 | 422 | `{"detail": "この内容はこのツールでは送信できません。"}` |
| 取り消せない | 409 | `{"detail": "すでに配信されたため取り消せません。"}` |
| AI が3回とも失敗 | 502 | `{"detail": "解析に失敗しました。もう一度お試しください。"}` |
| レート制限 | 429 | slowapi 既定 |

web 側はこの `detail` をそのまま画面に出す。**文言は現行の Server Actions と一致させる。**

## レート制限（利用者単位）

api は web コンテナからしか到達しない（外部公開していない）。素朴に送信元 IP をキーにすると
全利用者が同じ送信元（web）に見え、上限がサイト全体で共有されてしまう。そのため web が
`X-Client-Id` ヘッダを付けて利用者を識別し、api 側はそれをキーにレート制限する
（`src/lib/api.ts` / `backend/app/api/limits.py`）。

- web は Cloudflare の `cf-connecting-ip` を優先し、無ければ `x-forwarded-for`（先頭の1件）、
  どちらも取れなければ固定値 `"unknown"` にフォールバックして `X-Client-Id` に載せる
- api は `X-Client-Id` があればそれを、無ければ（ヘッダ無しでの直接アクセス等）送信元 IP を
  キーにする。ヘッダ値は先頭200文字に切り詰めて正規化する

| 対象 | 上限 |
|---|---|
| `POST /analyze`, `POST /blur` | 20 / 分 |
| `POST /reports`, `POST /escalations` | 10 / 分 |

## データ

### `reports`
| 列 | 型 | 備考 |
|---|---|---|
| id | uuid | 主キー。時刻を含めない |
| author_id | text | **受信者向けの応答に出さない** |
| target_id | text | |
| severity | smallint | 1 か 2（3 は保存しない） |
| body | text | 送信者が確認した整理後の文面 |
| raw_body | text | 原文（仕様書 2.8）。受信者に出さない |
| has_context | boolean | |
| status | text | `pending` / `delivered` |
| composed | jsonb | `{what, why, how}` または null |
| response | text | `ack` / `dispute` / null |
| created_at | timestamptz | |

### `escalations`
| 列 | 型 |
|---|---|
| id | uuid |
| author_id | text |
| raw_body | text |
| severity_reason | text |
| created_at | timestamptz |

### 保持期限
`created_at` から `RETENTION_DAYS`（既定 30）を過ぎた行は削除する。起動時と1日1回。

## 環境変数

| 名前 | 使う側 | 既定 |
|---|---|---|
| `DATABASE_URL` | api | — |
| `GEMINI_API_KEY` | api | 未設定ならスタブ |
| `GEMINI_MODEL` | api | `gemini-3.1-flash-lite` |
| `RETENTION_DAYS` | api | `30` |
| `API_BASE_URL` | web | `http://api:8000` |

鍵は api だけが持つ。web には渡さない。
