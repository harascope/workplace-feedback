import { defineConfig, devices } from "@playwright/test";

const PORT = 3200;

// CI では web/api/db を docker compose で起動し、E2E_BASE_URL でその web（localhost:3000）を指す。
// api はホストにポートを出さないコンテナ内サービスなので、単体の next start では届かない。
// 未設定（ローカル実行）なら今までどおり単体の next start をこの config が自分で立てる。
const externalBaseURL = process.env.E2E_BASE_URL;
const baseURL = externalBaseURL ?? `http://localhost:${PORT}`;

/**
 * データはサーバープロセスのメモリ1つを全テストで共有するので、並列にしない。
 * 各テストは冒頭で e2e/helpers.ts の resetDemo() を呼び、初期状態から始める。
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL,
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  // E2E_BASE_URL があるときは compose が起動済みの web を使うので、ここでは何も立てない
  webServer: externalBaseURL
    ? undefined
    : {
        // dev サーバーは使わない。起動中の dev とロックが衝突し、データの汚れも共有してしまうため
        command: `npm run build && npx next start -p ${PORT}`,
        url: baseURL,
        // CI の標準ランナー（2 vCPU）でキャッシュなしのビルドが遅くなっても足りるように
        timeout: 300_000,
        reuseExistingServer: false,
        // 空にしてスタブを強制する。実 API は呼ばない
        env: { GEMINI_API_KEY: "" },
      },
});
