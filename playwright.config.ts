import { defineConfig, devices } from "@playwright/test";

const PORT = 3200;
const baseURL = `http://localhost:${PORT}`;

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
  webServer: {
    // dev サーバーは使わない。起動中の dev とロックが衝突し、データの汚れも共有してしまうため
    command: `npm run build && npx next start -p ${PORT}`,
    url: baseURL,
    // CI の標準ランナー（2 vCPU）でキャッシュなしのビルドが遅くなっても足りるように
    timeout: 300_000,
    reuseExistingServer: false,
    // 空にしてスタブを強制する。実 API は呼ばない
    env: { ANTHROPIC_API_KEY: "" },
  },
});
