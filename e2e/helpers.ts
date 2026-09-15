import { expect, type Page, type Request, type Response } from "@playwright/test";

/** Next.js は Server Action の呼び出しを、Next-Action ヘッダー付きの POST で送る */
export const isServerActionRequest = (req: Request): boolean =>
  req.method() === "POST" && "next-action" in req.headers();

export const isServerActionResponse = (res: Response): boolean => isServerActionRequest(res.request());

/** 管理者画面の「N件 未配信」 */
export const pendingStat = (page: Page) =>
  page.getByText("件 未配信", { exact: true }).locator("xpath=..");

/** 管理者画面の部署カードにある「重大度2以上が …」の行 */
export const deptDetail = (page: Page, dept: string) =>
  page.getByText(dept, { exact: true }).locator("xpath=..").getByRole("paragraph");

/** 入口の画面から利用者として入る */
export async function chooseUser(page: Page) {
  await page.getByRole("button", { name: /^利用者として使う/ }).click();
  await expect(page.getByRole("button", { name: "書く", exact: true })).toBeVisible();
}

/** 入口の画面から管理者として入る */
export async function chooseAdmin(page: Page) {
  await page.getByRole("button", { name: /^管理者として見る/ }).click();
  await expect(pendingStat(page)).toBeVisible();
}

/** 読み込み直して利用者画面を開く。画面の状態（完了画面など）は捨てられる */
export async function openUser(page: Page) {
  await page.goto("/");
  await chooseUser(page);
}

/** 読み込み直して管理者画面を開く。表示は最新のストアの内容になる */
export async function openAdmin(page: Page) {
  await page.goto("/");
  await chooseAdmin(page);
}

/** ストアを初期状態に戻す。各テストの冒頭で呼ぶ */
export async function resetDemo(page: Page) {
  await openAdmin(page);
  // 実 API を呼んでいないことを確かめる。これが見えれば stubModeAction も返っている
  await expect(page.getByText(/^スタブ動作中。/)).toBeVisible();

  // 入口の読み込みは済んでいるので、次に返る Server Action は初期化のもの
  const reset = page.waitForResponse(isServerActionResponse);
  await page.getByRole("button", { name: "デモを初期状態に戻す", exact: true }).click();
  await reset;

  await expect(pendingStat(page)).toHaveText("1件 未配信");
  await expect(page.getByText("ありません", { exact: true })).toBeVisible();
}

/** 書く画面で本文を入れて「内容を確認する」を押す。結果の確認は呼び出し側で行う */
export async function analyze(page: Page, body: string) {
  await page.getByRole("textbox", { name: "気になったこと", exact: true }).fill(body);
  await page.getByRole("button", { name: "内容を確認する", exact: true }).click();
}

/** 宛先が本文から自動で選ばれる文を送り、完了画面が出るまで待つ */
export async function sendFeedback(page: Page, body: string) {
  await analyze(page, body);
  const send = page.getByRole("button", { name: "送る", exact: true });
  await expect(send).toBeEnabled();
  await send.click();
  await expect(page.getByText("受け付けました", { exact: true })).toBeVisible();
}

/** 管理者画面で未配信をすべて配信する */
export async function deliver(page: Page) {
  await page.getByRole("button", { name: "いま配信する", exact: true }).click();
  await expect(pendingStat(page)).toHaveText("0件 未配信");
}

/** 利用者画面で表示する人物を切り替え、「届いたもの」を開く */
export async function openInboxAs(page: Page, label: string) {
  await page.getByRole("combobox", { name: "表示する人物", exact: true }).selectOption({ label });
  // 件数バッジが付くと名前が「届いたもの2」のように変わるので、先頭一致で探す
  await page.getByRole("button", { name: /^届いたもの/ }).click();
}
