import { expect, test } from "@playwright/test";
import {
  deliver,
  deptDetail,
  openAdmin,
  openInboxAs,
  openUser,
  pendingStat,
  resetDemo,
  sendFeedback,
} from "./helpers";

/** 初期データで配信済みの1件（佐藤部長あて）の、受信画面に出る文面 */
const SEEDED_DELIVERED = "会議中、相手の発言の途中で話し始めることがありました。";

test.beforeEach(async ({ page }) => {
  await resetDemo(page);
});

test("部署評価は送信直後には変わらず、配信すると反映される", async ({ page, context }) => {
  await openAdmin(page);
  await expect(deptDetail(page, "営業部")).toHaveText("重大度2以上が 1/1");

  const user = await context.newPage();
  await openUser(user);
  await sendFeedback(user, "佐藤部長に打ち合わせで発言を遮られた");

  await openAdmin(page);
  // 件数が増えていれば、送信後の内容で読み込み直せている
  await expect(pendingStat(page)).toHaveText("2件 未配信");
  await expect(deptDetail(page, "営業部")).toHaveText("重大度2以上が 1/1");

  // 初期データの未配信1件（佐藤部長あて・重大度1）も一緒に配信されるので、分母は3になる
  await deliver(page);
  await expect(deptDetail(page, "営業部")).toHaveText("重大度2以上が 1/3 ・ 特定の1名に集中");
});

test("配信後に宛先の人で開くと届いていて、応答できる", async ({ page }) => {
  const body = "佐藤部長に朝礼で発言を遮られた";

  await openUser(page);
  await sendFeedback(page, body);
  await openAdmin(page);
  await deliver(page);

  await openUser(page);
  await openInboxAs(page, "佐藤 健一（部長）");
  await expect(page.getByText("佐藤 健一 として表示しています", { exact: true })).toBeVisible();

  // 初期データの配信済み1件と未配信だった1件、いま送った1件
  const items = page.getByRole("article");
  await expect(items).toHaveCount(3);
  const sent = items.filter({ hasText: body });
  const seeded = items.filter({ hasText: SEEDED_DELIVERED });
  await expect(sent).not.toContainText("鈴木");

  await sent.getByRole("button", { name: "理解した", exact: true }).click();
  await expect(sent.getByText("「理解した」と回答済み", { exact: true })).toBeVisible();
  await expect(sent.getByRole("button", { name: "認識が違う", exact: true })).toHaveCount(0);

  await seeded.getByRole("button", { name: "認識が違う", exact: true }).click();
  await expect(seeded.getByText(/^「認識が違う」と回答済み。/)).toBeVisible();

  // 応答はサーバーに残る
  await openUser(page);
  await openInboxAs(page, "佐藤 健一（部長）");
  await expect(sent.getByText("「理解した」と回答済み", { exact: true })).toBeVisible();
  await expect(seeded.getByText(/^「認識が違う」と回答済み。/)).toBeVisible();
});
