import { expect, test } from "@playwright/test";
import { analyze, openAdmin, openUser, pendingStat, resetDemo } from "./helpers";

const ESCALATE = { name: "人事へ引き継ぐ", exact: true } as const;
const HR_NOTICE = /^この相手は人事担当です。/;

test.beforeEach(async ({ page }) => {
  await resetDemo(page);
});

test("レベル3で人事へ引き継ぐと専用の完了画面になり、管理者画面に氏名と原文が1件出る", async ({ page }) => {
  const body = "昨日、上司に殴られた";

  await openUser(page);
  await analyze(page, body);
  await expect(page.getByText("このツールでは扱えません", { exact: true })).toBeVisible();
  await page.getByRole("button", ESCALATE).click();

  await expect(page.getByText("人事担当に、あなたの名前とともに届きました。", { exact: true })).toBeVisible();
  // 書く画面に戻ると同じ内容を二重に引き継げてしまう
  await expect(page.getByRole("textbox", { name: "気になったこと", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "内容を確認する", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", ESCALATE)).toHaveCount(0);
  await expect(page.getByRole("button", { name: "別の内容を書く", exact: true })).toBeVisible();

  await openAdmin(page);
  await expect(page.getByRole("heading", { name: "人事への引き継ぎ（1 件）", exact: true })).toBeVisible();
  const card = page.getByRole("article").filter({ hasText: body });
  await expect(card).toHaveCount(1);
  await expect(card.getByText("鈴木 花子", { exact: true })).toBeVisible();
  await expect(card.getByText(body, { exact: true })).toBeVisible();
  // 引き継ぎは匿名の申告とは別に扱う
  await expect(pendingStat(page)).toHaveText("1件 未配信");
});

test("人事担当の名前が書かれたレベル3では引き継ぎボタンを出さず、書かれていなければ出す", async ({ page }) => {
  await openUser(page);

  // 対象者の読み取りは先に出てくる佐藤部長になるが、本文に人事担当がいれば迂回する
  await analyze(page, "佐藤部長と伊藤さんに殴られた");
  await expect(page.getByText("このツールでは扱えません", { exact: true })).toBeVisible();
  await expect(page.getByText(HR_NOTICE)).toBeVisible();
  await expect(page.getByRole("button", ESCALATE)).toHaveCount(0);

  await page.getByRole("button", { name: "書き直す", exact: true }).click();
  await analyze(page, "上司に殴られた");
  await expect(page.getByRole("button", ESCALATE)).toBeVisible();
  await expect(page.getByText(HR_NOTICE)).toHaveCount(0);
});
