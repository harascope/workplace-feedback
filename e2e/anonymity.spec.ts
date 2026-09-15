import { expect, test } from "@playwright/test";
import { chooseAdmin, chooseUser, deliver, isServerActionRequest, openUser, resetDemo, sendFeedback } from "./helpers";

const REPORT_ID = /r[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/;
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

  await page.getByRole("button", { name: "管理者画面へ", exact: true }).click();
  await chooseAdmin(page);
  await deliver(page);

  await page.getByRole("button", { name: "利用者に戻る", exact: true }).click();
  await chooseUser(page);

  watchingRecipient = true;
  await page.getByRole("combobox", { name: "表示する人物", exact: true }).selectOption({ label: "佐藤 健一（部長）" });
  await expect(page.getByText("佐藤 健一 として表示しています", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: /^届いたもの/ }).click();
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
  // 時刻を ID に入れると、受信者に送信時刻が伝わりまとめ配信の意味がなくなる
  for (const text of all) expect(text).not.toMatch(/r\d{13}/);
});
