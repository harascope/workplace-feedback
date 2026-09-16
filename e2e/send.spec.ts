import { expect, test } from "@playwright/test";
import { analyze, deliver, openAdmin, openUser, pendingStat, resetDemo, screen, sendFeedback } from "./helpers";

const CANCEL_HINT = "配信前であれば、この画面から取り消せます。";

test.beforeEach(async ({ page }) => {
  await resetDemo(page);
});

test("送信後も完了画面が残り、取り消すと未配信件数が元に戻る", async ({ page, context }) => {
  // 完了画面の状態を捨てないよう、管理者画面は別ページで見る
  const admin = await context.newPage();
  await openAdmin(admin);
  await expect(pendingStat(admin)).toHaveText("1件 未配信");

  await openUser(page);
  await sendFeedback(page, "佐藤部長に会議で発言を遮られた");

  // 送信直後の再マウントで完了画面が消える不具合の回帰確認。待たずに見ると再マウント前に通ってしまうので、少し待っても残っていることを確かめる
  await page.waitForTimeout(1_000);
  await expect(page.getByText("受け付けました", { exact: true })).toBeVisible();
  await expect(page.getByText(CANCEL_HINT, { exact: true })).toBeVisible();

  await openAdmin(admin);
  await expect(pendingStat(admin)).toHaveText("2件 未配信");

  await screen(page).getByRole("button", { name: "取り消す", exact: true }).click();
  await expect(page.getByText("取り消しました", { exact: true })).toBeVisible();
  await expect(screen(page).getByRole("button", { name: "取り消す", exact: true })).toHaveCount(0);

  await openAdmin(admin);
  await expect(pendingStat(admin)).toHaveText("1件 未配信");
});

test("配信後に取り消そうとするとエラーになり、取り消しの案内とボタンが消える", async ({ page, context }) => {
  await openUser(page);
  await sendFeedback(page, "佐藤部長に定例で発言を遮られた");

  const admin = await context.newPage();
  await openAdmin(admin);
  await expect(pendingStat(admin)).toHaveText("2件 未配信");
  await deliver(admin);

  await screen(page).getByRole("button", { name: "取り消す", exact: true }).click();
  await expect(page.getByText("すでに配信されたため取り消せません。", { exact: true })).toBeVisible();
  await expect(page.getByText(CANCEL_HINT, { exact: true })).toHaveCount(0);
  await expect(screen(page).getByRole("button", { name: "取り消す", exact: true })).toHaveCount(0);
  await expect(page.getByText("受け付けました", { exact: true })).toBeVisible();
  await expect(screen(page).getByRole("button", { name: "別の内容を書く", exact: true })).toBeVisible();
});

test("本文に書かれた名前から宛先が自動で選ばれる", async ({ page }) => {
  await openUser(page);
  await analyze(page, "佐藤部長に会議で遮られた");

  const target = page.getByRole("combobox", { name: "誰に届けますか", exact: true });
  await expect(target).toHaveValue("u2");
  await expect(target.locator("option:checked")).toHaveText("佐藤 健一（営業部・部長）");
  await expect(screen(page).getByRole("button", { name: "この内容を送る", exact: true })).toBeEnabled();

  // 名前が無ければ決めつけず、利用者に選ばせる
  await screen(page).getByRole("button", { name: "書き直す", exact: true }).click();
  await analyze(page, "会議で発言を遮られた");
  await expect(page.getByText("相手に届く文面", { exact: true })).toBeVisible();
  await expect(target).toHaveValue("");
  await expect(screen(page).getByRole("button", { name: "この内容を送る", exact: true })).toBeDisabled();
});
