import { expect, type Page, type Request, type Response } from "@playwright/test";

/** Next.js は Server Action の呼び出しを、Next-Action ヘッダー付きの POST で送る */
export const isServerActionRequest = (req: Request): boolean =>
  req.method() === "POST" && "next-action" in req.headers();

export const isServerActionResponse = (res: Response): boolean => isServerActionRequest(res.request());

/**
 * タブバー（App.tsx の <nav className="tabbar">）。
 * タブの「送る」と書く画面の送信ボタン「送る」はアクセシブル名が同じなので、
 * タブの操作はここに絞らないと2つに当たる。
 */
export const tabbar = (page: Page) => page.getByRole("navigation");

/**
 * 画面本体（App.tsx の <main className="wrap">）。
 * タブバーの同名ボタンを拾わないよう、画面の中の操作はここに絞る。
 */
export const screen = (page: Page) => page.getByRole("main");

/** 管理者画面の「N件 未配信」 */
export const pendingStat = (page: Page) =>
  page.getByText("件 未配信", { exact: true }).locator("xpath=..");

/** 管理者画面の部署カードにある「重大度2以上が …」の行 */
export const deptDetail = (page: Page, dept: string) =>
  page.getByText(dept, { exact: true }).locator("xpath=..").getByRole("paragraph");

/** 「送る」タブを開く */
export async function chooseUser(page: Page) {
  await tabbar(page).getByRole("button", { name: "送る", exact: true }).click();
  await expect(screen(page).getByRole("textbox", { name: "気になったこと", exact: true })).toBeVisible();
}

/** 「管理者」タブを開く */
export async function chooseAdmin(page: Page) {
  await tabbar(page).getByRole("button", { name: "管理者", exact: true }).click();
  await expect(pendingStat(page)).toBeVisible();
}

/** 読み込み直して「送る」タブを開く。画面の状態（完了画面など）は捨てられる */
export async function openUser(page: Page) {
  await page.goto("/");
  await chooseUser(page);
}

/** 読み込み直して「管理者」タブを開く。表示は最新のストアの内容になる */
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
  // このボタンだけは <footer> にあるので、画面本体（main）には絞らない
  await page.getByRole("button", { name: "デモを初期状態に戻す", exact: true }).click();
  await reset;

  await expect(pendingStat(page)).toHaveText("1件 未配信");
  await expect(page.getByText("ありません", { exact: true })).toBeVisible();
}

/** 書く画面で本文を入れて「内容を確認する」を押す。結果の確認は呼び出し側で行う */
export async function analyze(page: Page, body: string) {
  await screen(page).getByRole("textbox", { name: "気になったこと", exact: true }).fill(body);
  await screen(page).getByRole("button", { name: "内容を確認する", exact: true }).click();
}

/** 宛先が本文から自動で選ばれる文を送り、完了画面が出るまで待つ */
export async function sendFeedback(page: Page, body: string) {
  await analyze(page, body);
  const send = screen(page).getByRole("button", { name: "この内容を送る", exact: true });
  await expect(send).toBeEnabled();
  await send.click();
  await expect(page.getByText("受け付けました", { exact: true })).toBeVisible();
}

/** 管理者画面で未配信をすべて配信する */
export async function deliver(page: Page) {
  await screen(page).getByRole("button", { name: "いま配信する", exact: true }).click();
  await expect(pendingStat(page)).toHaveText("0件 未配信");
}

/** 「受け取りbox」タブを開き、中の人物カードで表示する人物を切り替える */
export async function openInboxAs(page: Page, label: string) {
  // 件数バッジが付くと名前が「受け取りbox2」のように変わるので、先頭一致で探す
  await tabbar(page).getByRole("button", { name: /^受け取りbox/ }).click();
  await screen(page).getByRole("button", { name: label, exact: true }).click();
}
