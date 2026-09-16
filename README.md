# 職場フィードバックツール（デモ）

職場での言動に関する不満を、AI を介して匿名で相手に伝える Web アプリ。
仕様は [docs/spec.md](docs/spec.md)。判断の理由まで書かれているので、実装前に読むこと。
web ⇄ api の HTTP 契約は [docs/api.md](docs/api.md)。

## 構成

web（Next.js）/ api（FastAPI）/ db（PostgreSQL）の3層。

```
ブラウザ ──▶ web（Next.js 16 / React 19）──▶ api（FastAPI / Python 3.13）──▶ PostgreSQL 17
              Server Actions が窓口              Gemini 呼び出しもここ
```

**api は外部公開しない。** ブラウザは web にしか触れず、web の Server Actions が
内部ネットワーク経由で api を呼ぶ（CORS 不要、鍵は api だけが持つ）。

| パス | 役割 |
|---|---|
| `src/app/actions.ts` | Server Actions。`src/lib/api.ts` 経由で api を呼ぶだけの薄い層 |
| `src/lib/api.ts` | api への fetch クライアント。応答は zod で検証 |
| `src/components/` | 画面 |
| `backend/app/domain/` | 重大度・匿名性・部署評価の規則、名簿 |
| `backend/app/ai/` | analyze・blur・compose・stub（Gemini 呼び出しとキー無し時の代替） |
| `backend/app/db/` | SQLAlchemy モデルとリポジトリ。受信箱用のクエリは匿名性のためにここで author_id/raw_body を持たない |
| `backend/app/api/` | ルーター・レート制限 |
| `backend/alembic/` | マイグレーション |

## セットアップ

Docker Desktop（または互換の Docker 環境）が動いていればよい。
Node / Python のバージョン差やネイティブ依存のインストール失敗を気にする必要がない。

```bash
cp .env.example .env.local
```

`.env.local` に Gemini の API キー（`GEMINI_API_KEY`）を入れる（無くても起動する。下記参照）。

```bash
docker compose up
```

http://localhost:3000

api の起動時に `alembic upgrade head` が自動で当たる（`docker-compose.yml` の command）ので、
マイグレーションを手動で叩く必要はない。

ホストにポートを出すのは web だけ。api と db は web と同じ Docker ネットワーク内からしか触れない。
`src/`・`backend/app/` はホストとコンテナ間でマウントされているので、ファイルを編集すれば
そのままホットリロードされる（web は Next.js の dev サーバー、api は `uvicorn --reload`）。
`node_modules` と Python の仮想環境はコンテナ側に閉じているので、ホスト側でのインストールは不要。

依存関係を追加・変更したとき（`package.json` や `backend/pyproject.toml` を書き換えたとき）は再ビルドする。

```bash
docker compose up --build
```

止めるとき:

```bash
docker compose down
```

データを含めて消すとき（db の名前付きボリュームも削除）:

```bash
docker compose down -v
```

### Docker を使わない方法

Node.js 22.13 以上（Vitest 5 の要件）と、Python 3.13 ＋ [uv](https://docs.astral.sh/uv/)、
それにローカルの PostgreSQL が必要。db は用意できないことが多いので、通常は上の Docker 方式を推奨する。

```bash
npm install
cp .env.example .env.local   # GEMINI_API_KEY は任意。NEXT_PUBLIC_ は付けないこと
npm run dev                  # http://localhost:3000
```

```bash
cd backend
uv sync
DATABASE_URL=postgresql+asyncpg://<user>:<pass>@localhost:5432/<db> uv run alembic upgrade head
DATABASE_URL=postgresql+asyncpg://<user>:<pass>@localhost:5432/<db> uv run uvicorn app.main:app --reload
```

## 環境変数

| 名前 | 使う側 | 既定 |
|---|---|---|
| `DATABASE_URL` | api | ― （必須。compose では `docker-compose.yml` が渡す） |
| `GEMINI_API_KEY` | api | 未設定ならスタブ |
| `GEMINI_MODEL` | api | `gemini-3.1-flash-lite` |
| `RETENTION_DAYS` | api | `30`（この日数を過ぎた申告・引き継ぎは自動削除） |
| `API_BASE_URL` | web | `http://api:8000` |

鍵は api だけが持つ。web には渡さない（`NEXT_PUBLIC_` を付けないのはもちろん、
サーバー側の環境変数としても web には置かない）。

## 実装上の不変条件

仕様書 8 章の原則から来ている。変更するときは理由を確認すること。

- **受信画面に送信者の情報を出さない。** `author_id` と `raw_body` は `backend/app/db/repositories/inbox.py` の
  クエリに含めない（select しない）。型で隠すだけでなく DB 層で担保する
- **Server Action の呼び出しログを出さない。** `next.config.mjs` の `logging.serverFunctions: false`。
  引数に `authorId` と本文が含まれ、dev ログから誰が書いたか分かってしまう
- **AI が促すとき、具体例も選択肢も出さない。** 誘導になり、記憶が汚染される
- **受信者向けの文面で断定しない。** 「こういう受け止めをした人がいます」
- **改善案を送信者の要望として書かない。** 「一般に、こうした場面では」
- **重大度レベル3 は送信を停止し、外部相談窓口を案内する。** UI とサーバー側の両方で止める
- **即時配信しない。** 週 1 のまとめ配信。デモでは管理者画面の手動配信で代用
- **申告ゼロの部署は「データなし」。** レベル1（安全）とは区別する
- **部署評価は配信済みの申告だけで集計する。** 送信直後に数字が動くと、誰が書いたか推測される
- **人事への引き継ぎは匿名の経路に混ぜない。** `escalations` は `reports` と別テーブルに置き、
  受信箱・配信・部署評価からは読まない

## 簡易実装

デモで流れを見せるための最小限の実装。

- **送信の取り消し。** 送信完了画面から、配信前に限り取り消せる。画面を離れると取り消す手段はない
- **人事への引き継ぎ（3.1）。** レベル3の画面で本人が同意したときだけ、実名で保存する。
  同意しなければ何も保存しない。引き継いだ内容は管理者画面に表示される。
  本文または対象者の手がかりに人事担当の姓が含まれるときは、引き継ぎを出さず社外窓口を案内する（3.4）

## 未実装

仕様書 7 章の未確定事項に対応する。

- 複数人からの申告による閾値エスカレーション（3.3）
- 送信後のフォローアップ（3 日 / 2 週 / 1 ヶ月）と報復検知（3.2）
- 対象者を特定しない申告（組織単位の記録、2.6）。`src/components/Compose.tsx` は宛先が必須で、
  対象者なしで送る経路が無い。部署アラート（6.2）とあわせて未実装
- 企業設定と、設定変更時の警告・変更履歴（6.3）。型と既定値は `src/lib/data/settings.ts` に
  先置きしてあるが、どこからも参照していない
- 認証

## API キー無しで動かす（スタブ）

`GEMINI_API_KEY` が未設定のときは、api の AI 呼び出しが `backend/app/ai/stub.py` の
簡易な代替処理に置き換わり、画面上部に「スタブ動作中」と表示される（`GET /meta` の `stub` を見て判定）。
UI の分岐（欠落の促し・特定リスク・レベル3停止・権力差・まとめ配信）は
このままひととおり確認できるが、文面の質は実 API とは別物。

キーを `.env.local` に設定すれば実 API に切り替わり、スタブは呼ばれない。

## テスト

### ユニット・コンポーネント（Vitest）

```bash
npm test
```

### バックエンド（pytest）

```bash
cd backend
uv sync
uv run ruff check .
uv run pytest
```

ドメイン規則・匿名性・AI（モック）はここでテストする。DB テストは SQLite（aiosqlite）で完結し、
実際の PostgreSQL は要らない。

### E2E（Playwright）

初回だけブラウザを入れる。

```bash
npx playwright install chromium
```

```bash
npm run test:e2e
```

既定では単体の `next start`（3200 番ポート、スタブ）を自動で立てて流す。
`E2E_BASE_URL` を渡すと、その URL（起動済みの web）に対して流す。
`docker compose up` で3サービスを起動した状態なら、api を経由した実際の構成で確認できる。

```bash
docker compose up -d --wait
E2E_BASE_URL=http://localhost:3000 npm run test:e2e
```

サーバー側のデータを全テストで共有するので、並列にせず直列で実行する。

### CI

GitHub Actions（`.github/workflows/test.yml`）に2ジョブある。

- `test`: 型チェック・Vitest のあと、`docker compose up --build --wait` で web/api/db を起動し、
  その web に対して Playwright E2E を流す
- `backend`: uv で依存を入れ、ruff → pytest。DB テストのために `services: postgres` を用意する

どちらも `GEMINI_API_KEY` は渡さない（api は未設定のままスタブで動く）。

## デプロイ

自宅ラボの VM（gpa-prod、`ubuntu@192.168.0.220`）に相乗りさせ、Cloudflare Tunnel 経由で
`https://feedback.fullweak.com` に出す。

### 構成

- イメージは2つ。web は `Dockerfile`（node:24-slim、`next.config.mjs` の `output: "standalone"` を動かす）、
  api は `backend/Dockerfile`（python:3.13-slim、uv で依存を入れて `uvicorn` を非 root で動かす）
- `deploy/docker-compose.yml` を VM の `/opt/workplace-feedback/` に置く。web（compose 上のサービス名は
  `feedback`。cloudflared ingress がこの名前を参照しているので変えていない）だけがホストにポートを出さず
  `gpa_default` ネットワークにも参加し、`feedback:3000` として cloudflared から見える。
  api と db はこのプロジェクト専用の内部ネットワークだけに置き、他の相乗りアプリからは触れない
- db は名前付きボリュームを持つので、コンテナを再作成してもデータは残る。
  保持期限（`RETENTION_DAYS`、既定30日）を過ぎた申告・引き継ぎは api が起動時と1日1回で自動削除する
- リソース上限: web 256M / api 256M / db 192M。`no-new-privileges` を全サービスに付与
- イメージはローカルでビルドして `docker save | gzip | ssh | docker load` で送る。VM のメモリでは
  `next build` や依存解決が落ちる恐れがあるため、VM 上ではビルドしない

### 更新（初回も2回目以降も同じ）

```bash
./deploy/deploy.sh
```

作業ツリーがクリーンであることを確かめ、短い sha をタグに2つのイメージ（web・api）をビルド・転送する。
db を起動して healthy を待ち、api イメージで `alembic upgrade head` を当ててから
web・api を起動し、web が healthy になるのを待って、古いイメージを片付ける（今の版と1つ前を残す）。

### 初回だけの作業

1. VM の `/opt/gpa/cloudflared.yml` をバックアップし、catch-all（`http_status:404`）の直前に足す。

   ```yaml
   - hostname: feedback.fullweak.com
     service: http://feedback:3000
   ```

   `docker restart gpa-cloudflared-1` で反映する。再起動の数秒間は、同じトンネルの他のホストも
   つながらなくなる。3層構成にしても web のサービス名（`feedback`）とポート（3000）は変えていないので、
   この ingress 設定自体の変更は不要。

2. DNS を登録する。証明書がこちら側にしか無いので、VM ではなく WSL から実行する。

   ```bash
   cloudflared tunnel route dns b4ccefb9-cd76-4153-86d7-597b60705ec9 feedback.fullweak.com
   ```

### 初回切り替え時の退避と巻き戻し

いま VM で動いているのは旧構成（web の単体コンテナ、イメージ名 `workplace-feedback`）。
3サービス構成を初めて反映するときだけ、以下を先にやっておく。2回目以降は不要。

1. 切り替え前に現状を控える。

   ```bash
   ssh ubuntu@192.168.0.220
   docker ps --format '{{.Names}}\t{{.Image}}\t{{.Status}}'   # 旧コンテナ名とイメージ:tag
   docker image ls workplace-feedback                         # 旧イメージに残っている tag
   docker inspect workplace-feedback-feedback-1 > ~/feedback-old.json
   ```

   旧コンテナ名は compose 起動なので `workplace-feedback-feedback-1` になっているはず。
   実際の名前は `docker ps` の出力で確かめる。`docker inspect` の結果は環境変数と
   ネットワークの控えになるので、`deploy.sh` が触らない場所（ホームなど）に置く。
   `/opt/workplace-feedback/` の中には置かない。

2. 旧イメージを消さない。`deploy/deploy.sh` のイメージ世代管理（`deploy/deploy.sh:81-82`）が
   対象にするのは `workplace-feedback-web` と `workplace-feedback-api`（`deploy/deploy.sh:9-10`）だけで、
   リポジトリ名の一致しない旧イメージ `workplace-feedback` は自動では消えない。
   手で `docker rmi` しないこと。巻き戻し先がなくなる。

3. 新構成が失敗したら、新スタックを落として旧イメージで単体コンテナを起動し直す。

   ```bash
   ssh ubuntu@192.168.0.220
   cd /opt/workplace-feedback
   docker compose -p workplace-feedback down          # -v は絶対に付けない（4 参照）
   docker run -d --name feedback --restart unless-stopped \
     --network gpa_default \
     --security-opt no-new-privileges:true \
     --env-file /opt/workplace-feedback/secrets.env \
     workplace-feedback:<控えた旧 TAG>
   ```

   cloudflared ingress は `feedback:3000` を引くので、コンテナ名は `feedback`、
   ネットワークは `gpa_default` でないと届かない。`secrets.env` を置いていなければ
   `--env-file` の行ごと落とす（スタブのまま起動する）。

   この単体コンテナは compose 管理外なので、`deploy.sh` の `--remove-orphans` では消えない。
   新構成を再挑戦する前に `docker rm -f feedback` で自分で消すこと。残したまま流すと
   `gpa_default` 上で `feedback` の名前が新しい web コンテナとぶつかる。

4. `down -v` を使わない。db は名前付きボリューム `db_data`
   （`deploy/docker-compose.yml:77-78`・`:99-100`）に載っていて、`docker compose down -v` は
   これごと消す＝申告・引き継ぎのデータが消える。巻き戻しでも再挑戦でも使うのは `down` だけ。
   なお旧構成に db は無い（`db_data` は使われないまま残る）。

### ロールバック

- 前の版に戻す: VM の `/opt/workplace-feedback/.env` の `TAG` を1つ前の sha に書き換えて
  `docker compose -p workplace-feedback up -d`。**マイグレーションは自動では巻き戻らない。**
  スキーマを追加しただけの変更なら通常は問題にならないが、破壊的なマイグレーションを戻すときは
  手動で `alembic downgrade` を検討する
- 止める: `ssh ubuntu@192.168.0.220 'cd /opt/workplace-feedback && docker compose -p workplace-feedback down'`

### API キー（Gemini）

鍵はイメージに焼かない。VM の `/opt/workplace-feedback/secrets.env` に `GEMINI_API_KEY=...` を置き、
`deploy/docker-compose.yml` の api サービスが `env_file`（`required: false`）で実行時に読む。
置いていなければスタブのまま起動する。web には鍵を渡さない。
`deploy/deploy.sh` は `secrets.env` を作らないし上書きもしない（`.env` に書くのは `TAG` だけ）。

認証なしで公開しているので、鍵を入れた状態では第三者の操作がそのまま課金につながる。
乱用対策として `POST /analyze` `/blur` `/reports` `/escalations` に IP 単位のレート制限を入れている
（`docs/api.md`「レート制限」参照）。絞るならさらに公開範囲を制限すること（Cloudflare Access など）。

データは PostgreSQL の名前付きボリュームに永続化される。コンテナを再起動してもデータは残る
（以前のインメモリ実装とはここが変わった）。保持期限を過ぎた行は自動で削除される。
