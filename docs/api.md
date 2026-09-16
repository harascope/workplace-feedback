# API 仕様書（web ⇄ api）

Next.js（web）と FastAPI（api）の間の契約。**この文書が唯一の拠り所**で、実装側が勝手に変えない。
api は外部公開しない。ブラウザは web にだけ触れ、web の Server Actions が api を呼ぶ。

- ベース URL: `API_BASE_URL`（既定 `http://api:8000`。本番だけ `http://wf-api:8000`）
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
- 409: 取り消せなかった。**理由によって `detail` が変わる**
  - 配信済みと確定できるときだけ「すでに配信されたため取り消せません。」と断定する
  - 本人でない・存在しないときは「取り消せませんでした。すでに配信されたか、この送信が見つかりません。」
  - 届いていないのに「届いた」と読める文言を出すと、送信者を無用に不安にさせるため断定しない。
    本人以外には、その申告が存在するかも配信済みかも伝えない（常に後者の文言）

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
  "depts": [{ "dept": "営業部", "level": 3, "label": "5 段階中 3", "detail": "重大度2以上が 1/1",
              "member_count": 3, "below_min_members": false, "alert": false }],
  "escalations": [{ "id": "…", "author_name": "鈴木 花子", "raw_body": "…",
                    "severity_reason": "暴力・脅迫等に該当しうる", "created_at": "2026-09-16T01:00:00Z" }],
  "severity_mix": { "level1": 2, "level2": 1 },
  "delivery": { "next_at": "2026-09-21T00:00:00Z", "interval_days": 7,
                "oldest_pending_days": 2, "delivered_total": 3 },
  "level_max": 5,
  "dept_alert_min_members": 3
}
```
- `deliver` は未配信を全部配信し、そのとき受信者向け文面（`composed`）を生成する。生成に失敗した件は `composed: null` のまま配信済みにする
- `depts[].level` は申告ゼロなら `null`、`label` は `"データなし"`
- `depts[].label` は `"5 段階中 3"` の形。**「レベル N」とは書かない。**
  「レベル」は申告の重大度（仕様書 3.1）を指す語で、送信画面の「レベル3＝このツールでは扱えない」と
  同じ表記にすると、管理者が「その部署にレベル3の案件がある」と読み違えるため
- **配信済みの申告だけを集計する**（時期ぼかし）。申告が1件だけの部署は `detail` に集中・分散を付けない
- `depts[].member_count` は名簿上の在籍人数。**申告の件数ではない**
- `depts[].below_min_members` は在籍人数が `dept_alert_min_members` に満たないこと。満たない部署では部署アラートを出さない（仕様書 6.2「母数下限」）
- `depts[].alert` は部署アラート（仕様書 6.2）。母数下限を満たし、**異なる申告者**が閾値以上いて、対象者が複数名に分散しているときだけ true。
  1人に集中しているものは個人の問題として扱い、true にしない。**件数は返さない**（件数非表示）
- `severity_mix` は配信済みの重大度の内訳。**全社の合計のみ**で、部署 × 重大度は返さない。レベル3は申告として保存しないので現れない
- `delivery.next_at` は次のまとめ配信（毎週月曜 9:00 JST）。`oldest_pending_days` は未配信が無ければ `null`
- 申告者（`author_id`）は**管理者向けの応答にも出さない**。実名が出るのは本人が同意した `escalations` だけ

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
- **この件数は E2E が依存しているので変えない。** 量のあるデータが要るときは `/admin/seed-demo` を使う

### `POST /admin/seed-demo`
- 200。応答は `GET /admin` と同じ `AdminView`
- デモ用のサンプルデータ（申告 22 件・引き継ぎ 2 件）を入れる。名簿6人と部署構成に沿わせ、
  複数部署・複数重大度・配信済み／未配信・応答済み／未応答が混ざる。作成日は過去数週間にばらつく
- **入れ直す前に全件消す**（何度呼んでも同じ状態になる）
- `/admin/reset` とは別経路。reset の件数は変えない

## エラー

| 状況 | 状態コード | 本文 |
|---|---|---|
| 入力が不正 | 422 | FastAPI 既定 |
| 重大度3の送信 | 422 | `{"detail": "この内容はこのツールでは送信できません。"}` |
| 取り消せない（配信済みと確定） | 409 | `{"detail": "すでに配信されたため取り消せません。"}` |
| 取り消せない（本人でない・存在しない） | 409 | `{"detail": "取り消せませんでした。すでに配信されたか、この送信が見つかりません。"}` |
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
| `POST /admin/deliver` | 12 / 分 |
| `POST /admin/reset` | 20 / 分 |
| `POST /admin/seed-demo` | 6 / 分 |

管理系は認証が無く、`deliver` は AI（課金）を呼び、`reset` と `seed-demo` は全件消す。
上限はデモ操作を妨げない範囲で連打を止める値にしている。

- `/admin/reset` だけ高いのは **E2E が各テストの冒頭で必ず呼ぶ**ため。8テスト × `beforeEach` で
  1周8回、CI は `retries: 1` なので最悪16回。ここを下回ると E2E が 429 で落ちる
- `/admin/deliver` は E2E が1周で4回。`/admin/seed-demo` は E2E からは呼ばない

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
| `GEMINI_API_KEY` | api | 未設定ならスタブ（`AI_PROVIDER=ollama` のときは無視） |
| `GEMINI_MODEL` | api | `gemini-3.1-flash-lite` |
| `AI_PROVIDER` | api | `gemini`（`ollama` に変えるとローカル推論。課金されない） |
| `OLLAMA_BASE_URL` | api | `http://127.0.0.1:11434` |
| `OLLAMA_MODEL` | api | `gemma3:12b` |
| `RETENTION_DAYS` | api | `30` |
| `API_BASE_URL` | web | `http://api:8000` |

`API_BASE_URL` は本番だけ `http://wf-api:8000`。本番の web は cloudflared 用に共有ネットワーク
`gpa_default` にも属し、そこにいる別プロジェクトの `api` に名前が奪われるので、`deploy/docker-compose.yml`
が api に一意なエイリアス `wf-api` を与えている。開発・CI は衝突しないので `api` のまま。

鍵は api だけが持つ。web には渡さない。
