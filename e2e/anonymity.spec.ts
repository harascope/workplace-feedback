import { expect, test } from "@playwright/test";
import {
  chooseAdmin,
  chooseUser,
  deliver,
  isServerActionRequest,
  openUser,
  resetDemo,
  screen,
  sendFeedback,
  tabbar,
} from "./helpers";

// ID は Postgres 側の uuid4() 由来で、旧実装にあった "r" 接頭辞は付かない
const REPORT_ID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/;
const BODY = "佐藤部長に客先で発言を遮られた";

test.beforeEach(async ({ page }) => {
  await resetDemo(page);
});

test("宛先の画面に届く応答に送信者の情報が無く、ID に時刻が入っていない", async ({ page }) => {
  await openUser(page);

  const all: string[] = [];
  // 管理者画面の応答は引き継ぎの氏名などを正当に含むので、宛先の画面に切り替えた後のものだけを分けて集める
  const recipient: string[] = [];
  let watchingRecipient = false;

  // 応答の後から CDP で本文を取り出す方式は取得に失敗することがあるので、中継してブラウザへ返す前に本文を控える
  await page.route(
    (url) => url.pathname === "/",
    async (route) => {
      if (!isServerActionRequest(route.request())) return route.fallback();
      const inRecipient = watchingRecipient;
      const res = await route.fetch();
      const body = await res.body();
      // Content-Type（text/x-component）に charset が無いので、自分で UTF-8 として読む
      const text = body.toString("utf8");
      all.push(text);
      if (inRecipient) recipient.push(text);
      await route.fulfill({ response: res, body });
    },
  );

  // 送信者は鈴木 花子（u3）
  await sendFeedback(page, BODY);

  await chooseAdmin(page);
  await deliver(page);

  await chooseUser(page);

  watchingRecipient = true;
  await tabbar(page).getByRole("button", { name: /^受け取りbox/ }).click();
  await screen(page).getByRole("button", { name: "佐藤 健一（部長）", exact: true }).click();
  await expect(page.getByText("佐藤 健一 として表示しています", { exact: true })).toBeVisible();
  const sent = page.getByRole("article").filter({ hasText: BODY });
  await sent.getByRole("button", { name: "理解した", exact: true }).click();
  await expect(sent.getByText("「理解した」と回答済み", { exact: true })).toBeVisible();

  // 送った文面が見つかれば、見るべき応答を集められていて、日本語も正しく読めている
  expect(recipient.some((t) => t.includes(BODY))).toBe(true);
  for (const text of recipient) {
    expect(text).not.toContain("authorId");
    expect(text).not.toContain("rawBody");
    expect(text).not.toContain('"u3"');
    expect(text).not.toContain("鈴木");
  }

  expect(all.some((t) => REPORT_ID.test(t))).toBe(true);
  // 時刻を ID に入れると、受信者に送信時刻が伝わりまとめ配信の意味がなくなる。
  // 接頭辞に依らず、13桁の数字（ミリ秒タイムスタンプ相当）が ID として出ないことを見る
  for (const text of all) expect(text).not.toMatch(/\b\d{13}\b/);
});
