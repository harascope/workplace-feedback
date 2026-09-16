"use server";

import * as api from "@/lib/api";
import type { Analysis, Severity } from "@/lib/ai/schemas";
import type { AdminView, InboxItem } from "@/lib/api";

export type Result<T> = { ok: true; data: T } | { ok: false; error: string };

export type { AdminView };

/** api の detail をそのまま画面へ出す（docs/api.md）。それ以外の失敗はフォールバック文言にする */
function fail(e: unknown, fallback: string): { ok: false; error: string } {
  console.error(e);
  return { ok: false, error: e instanceof api.ApiError ? e.message : fallback };
}

export async function analyzeAction(meId: string, body: string): Promise<Result<Analysis>> {
  try {
    return { ok: true, data: await api.analyze(meId, body) };
  } catch (e) {
    return fail(e, "解析に失敗しました。もう一度お試しください。");
  }
}

export async function blurAction(text: string): Promise<Result<string>> {
  try {
    return { ok: true, data: await api.blur(text) };
  } catch (e) {
    return fail(e, "書き直しに失敗しました。");
  }
}

export async function sendAction(input: {
  authorId: string;
  targetId: string;
  severity: Severity;
  body: string;
  rawBody: string;
  hasContext: boolean;
}): Promise<Result<{ id: string }>> {
  // レベル3はこのツールで扱わない。UI で止めているが、api 側でも拒否する（422）。
  if (input.severity === 3) {
    return { ok: false, error: "この内容はこのツールでは送信できません。" };
  }
  try {
    return { ok: true, data: await api.createReport(input) };
  } catch (e) {
    return fail(e, "送信に失敗しました。");
  }
}

/** 送信の取り消し。配信後は受信者の手元にあるので消さない。 */
export async function cancelAction(authorId: string, id: string): Promise<Result<null>> {
  try {
    await api.cancelReport(id, authorId);
    return { ok: true, data: null };
  } catch (e) {
    return fail(e, "取り消しに失敗しました。");
  }
}

/**
 * 人事への引き継ぎ（仕様書 3.1）。レベル3の画面で本人が同意したときだけ呼ばれる。
 * 実名での相談になるため、匿名の Report とは別に保存する。
 */
export async function escalateAction(input: {
  authorId: string;
  rawBody: string;
  severityReason: string;
}): Promise<Result<null>> {
  try {
    await api.createEscalation(input);
    return { ok: true, data: null };
  } catch (e) {
    return fail(e, "引き継ぎに失敗しました。");
  }
}

export async function inboxAction(meId: string): Promise<Result<InboxItem[]>> {
  try {
    return { ok: true, data: await api.getInbox(meId) };
  } catch (e) {
    return fail(e, "受信箱の取得に失敗しました。");
  }
}

export async function respondAction(id: string, kind: "ack" | "dispute"): Promise<Result<null>> {
  try {
    await api.respond(id, kind);
    return { ok: true, data: null };
  } catch (e) {
    return fail(e, "応答の送信に失敗しました。");
  }
}

export async function adminAction(): Promise<Result<AdminView>> {
  try {
    return { ok: true, data: await api.getAdmin() };
  } catch (e) {
    return fail(e, "管理者情報の取得に失敗しました。");
  }
}

/**
 * まとめ配信。本番は週1のバッチだが、デモでは管理者が手動で起動する。
 * 受信者向けの文面はこの時点で api 側が生成する。
 */
export async function deliverAction(): Promise<Result<AdminView>> {
  try {
    return { ok: true, data: await api.deliver() };
  } catch (e) {
    return fail(e, "配信に失敗しました。");
  }
}

export async function resetAction(): Promise<Result<null>> {
  try {
    await api.resetDemo();
    return { ok: true, data: null };
  } catch (e) {
    return fail(e, "初期化に失敗しました。");
  }
}

/** スタブ動作中かどうか。画面に明示するために使う。 */
export async function stubModeAction(): Promise<boolean> {
  try {
    return (await api.getMeta()).stub;
  } catch (e) {
    console.error(e);
    return false;
  }
}
