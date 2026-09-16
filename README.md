# 職場フィードバックツール（デモ）

職場での言動に関する不満を、AI を介して匿名で相手に伝える Web アプリ。
仕様は [docs/spec.md](docs/spec.md)。判断の理由まで書かれているので、実装前に読むこと。

## セットアップ

Docker を使う方法と、ローカルに Node.js を入れる方法のどちらでもよい。
チームで環境を揃えたいなら Docker を推奨。

### Docker（推奨）

Docker Desktop が動いていればよい。Node のバージョン差やネイティブ依存の
インストール失敗を気にする必要がない。

```bash
cp .env.example .env.local
```

`.env.local` に Anthropic の API キーを入れる（無くても起動する。下記参照）。

```bash
docker compose up
```

http://localhost:3000

ソースはホストとコンテナ間でマウントされているので、ファイルを編集すれば
そのままホットリロードされる。`node_modules` はコンテナ専用の Docker ボリュームに
分離してあるので、ホスト側で `npm install` する必要はない。

依存関係を追加・変更したとき（`package.json` を書き換えたとき）は再ビルドする。

```bash
docker compose up --build
```

止めるとき:

```bash
docker compose down
```

### ローカルに Node.js を入れる方法

Node.js 22.13 以上が必要（テストに使う Vitest 5 の要件）。

```bash
npm install
```

```bash
cp .env.example .env.local
```

`.env.local` に Anthropic の API キーを入れる。`NEXT_PUBLIC_` は付けないこと。

```bash
npm run dev
```

http://localhost:3000

## 構成

| パス | 役割 |
|---|---|
| `src/lib/ai/analyze.ts` | 行動・場面・対象者の抽出、重大度判定、特定リスク判定（1 回の呼び出し） |
| `src/lib/ai/blur.ts` | 特定されにくい表現への書き直し |
| `src/lib/ai/compose.ts` | 受信者向けフィードバック生成（what / why / how） |
| `src/lib/ai/schemas.ts` | 出力の zod スキーマ |
| `src/lib/ai/client.ts` | Anthropic 呼び出し。スキーマ検証に失敗したら理由を添えて再試行 |
| `src/lib/store.ts` | インメモリストア。開発サーバー再起動で消える |
| `src/app/actions.ts` | Server Actions。API キーに触れる唯一の経路 |
| `src/components/` | 画面 |

AI の 4 関数は UI と DB を知らない。入力を受けて構造化された値を返すだけなので、
プロンプトのチューニングは UI を触らずに行える。

## 実装上の不変条件

仕様書 8 章の原則から来ている。変更するときは理由を確認すること。

- **受信画面に送信者の情報を出さない。** `authorId` は `Report` にしかなく、受信者に渡る
  `InboxItem` は型として持たない。`listInbox()` は `authorId` を読まずに組み立てる
- **Server Action の呼び出しログを出さない。** `next.config.mjs` の `logging.serverFunctions: false`。
  引数に `authorId` と本文が含まれ、dev ログから誰が書いたか分かってしまう
- **AI が促すとき、具体例も選択肢も出さない。** 誘導になり、記憶が汚染される
- **受信者向けの文面で断定しない。** 「こういう受け止めをした人がいます」
- **改善案を送信者の要望として書かない。** 「一般に、こうした場面では」
- **重大度レベル3 は送信を停止し、外部相談窓口を案内する。** UI とサーバー側の両方で止める
- **即時配信しない。** 週 1 のまとめ配信。デモでは管理者画面の手動配信で代用
- **申告ゼロの部署は「データなし」。** レベル1（安全）とは区別する
- **部署評価は配信済みの申告だけで集計する。** 送信直後に数字が動くと、誰が書いたか推測される
- **人事への引き継ぎは匿名の経路に混ぜない。** `Escalation` は `Report` と別の配列に置き、
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
- 部署アラート（6.2）
- 企業設定と、設定変更時の警告・変更履歴（6.3）
- レート制限（4.2）
- 認証、永続化

## API キー無しで動かす（スタブ）

`ANTHROPIC_API_KEY` が未設定のときは、AI 呼び出しが `src/lib/ai/stub.ts` の
簡易な代替処理に置き換わり、画面上部に「スタブ動作中」と表示される。
UI の分岐（欠落の促し・特定リスク・レベル3停止・権力差・まとめ配信）は
このままひととおり確認できるが、文面の質は実 API とは別物。

キーを `.env.local` に設定すれば実 API に切り替わり、スタブは呼ばれない。

## テスト

### ユニット・コンポーネント（Vitest）

```bash
npm test
```

### E2E（Playwright）

初回だけブラウザを入れる。

```bash
npx playwright install chromium
```

```bash
npm run test:e2e
```

本番ビルドを 3200 番ポートで起動し、スタブで動かす。サーバーのメモリ上のデータを
全テストで共有するので、並列にせず直列で実行する。

### CI

GitHub Actions で push と pull request のたびに、型チェック・ユニット・E2E を実行する。
API キーは使わない（スタブで動く）。

## デプロイ

自宅ラボの VM（gpa-prod、`ubuntu@192.168.0.220`）に相乗りさせ、Cloudflare Tunnel 経由で
`https://feedback.fullweak.com` に出す。

### 構成

- `next.config.mjs` の `output: "standalone"` で、依存を同梱した `.next/standalone` を作る
- `Dockerfile`（node:24-slim のマルチステージ）の runner 段には standalone と `.next/static` だけを置き、
  `USER node` で `node server.js` を動かす
- `deploy/docker-compose.yml` を VM の `/opt/workplace-feedback/` に置く。ホストにポートは出さず、
  `gpa_default` ネットワーク内の `feedback:3000` として cloudflared から参照する
- イメージはローカルでビルドして `docker save | ssh | docker load` で送る。VM のメモリでは
  `next build` が落ちる恐れがあるため、VM 上ではビルドしない

### 更新（初回も2回目以降も同じ）

```bash
./deploy/deploy.sh
```

作業ツリーがクリーンであることを確かめ、短い sha をタグにしてビルド・転送・起動し、
healthy を待ってから古いイメージを片付ける（今の版と1つ前を残す）。

### 初回だけの作業

1. VM の `/opt/gpa/cloudflared.yml` をバックアップし、catch-all（`http_status:404`）の直前に足す。

   ```yaml
   - hostname: feedback.fullweak.com
     service: http://feedback:3000
   ```

   `docker restart gpa-cloudflared-1` で反映する。再起動の数秒間は、同じトンネルの他のホストも
   つながらなくなる。

2. DNS を登録する。証明書がこちら側にしか無いので、VM ではなく WSL から実行する。

   ```bash
   cloudflared tunnel route dns b4ccefb9-cd76-4153-86d7-597b60705ec9 feedback.fullweak.com
   ```

### ロールバック

- 前の版に戻す: VM の `/opt/workplace-feedback/.env` の `TAG` を1つ前の sha に書き換えて
  `docker compose -p workplace-feedback up -d`
- 止める: `ssh ubuntu@192.168.0.220 'cd /opt/workplace-feedback && docker compose -p workplace-feedback down'`

### API キーを入れない

本番に `ANTHROPIC_API_KEY` は設定せず、スタブで動かす。認証なしで公開するので、キーを入れると
第三者の操作がそのまま課金につながる。キーを入れるなら、先に公開範囲を絞ること（Cloudflare Access など）。
コンテナを再起動するとデータは消える（インメモリのため、仕様どおり）。
