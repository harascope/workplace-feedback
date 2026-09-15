"use server";

import { analyze as aiAnalyze } from "@/lib/ai/analyze";
import { blur as aiBlur } from "@/lib/ai/blur";
import { compose as aiCompose } from "@/lib/ai/compose";
import type { Analysis, Severity } from "@/lib/ai/schemas";
import { USERS } from "@/lib/data/users";
import {
  addReport,
  evaluateDepts,
  listInbox,
  listPending,
  markDelivered,
  pendingCount,
  resetStore,
  respond as storeRespond,
  type DeptEval,
  type InboxItem,
} from "@/lib/store";

export type Result<T> = { ok: true; data: T } | { ok: false; error: string };

function fail(e: unknown, fallback: string): { ok: false; error: string } {
  console.error(e);
  return { ok: false, error: fallback };
}

export async function analyzeAction(meId: string, body: string): Promise<Result<Analysis>> {
  try {
    const names = USERS.filter((u) => u.id !== meId).map((u) => u.name);
    return { ok: true, data: await aiAnalyze({ body, candidateNames: names }) };
  } catch (e) {
    return fail(e, "解析に失敗しました。もう一度お試しください。");
  }
}

export async function blurAction(text: string): Promise<Result<string>> {
  try {
    return { ok: true, data: await aiBlur(text) };
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
}): Promise<Result<null>> {
  // レベル3はこのツールで扱わない。UI で止めているが、サーバー側でも拒否する。
  if (input.severity === 3) {
    return { ok: false, error: "この内容はこのツールでは送信できません。" };
  }
  try {
    addReport(input);
    return { ok: true, data: null };
  } catch (e) {
    return fail(e, "送信に失敗しました。");
  }
}

export async function inboxAction(meId: string): Promise<Result<InboxItem[]>> {
  return { ok: true, data: listInbox(meId) };
}

export async function respondAction(id: string, kind: "ack" | "dispute"): Promise<Result<null>> {
  storeRespond(id, kind);
  return { ok: true, data: null };
}

export type AdminView = { pending: number; depts: DeptEval[] };

export async function adminAction(): Promise<Result<AdminView>> {
  return { ok: true, data: { pending: pendingCount(), depts: evaluateDepts() } };
}

/**
 * まとめ配信。本番は週1のバッチだが、デモでは管理者が手動で起動する。
 * 受信者向けの文面はこの時点で生成する。
 */
export async function deliverAction(): Promise<Result<AdminView>> {
  try {
    const batch = listPending();
    for (const r of batch) {
      let composed = null;
      try {
        composed = await aiCompose(r.body);
      } catch (e) {
        console.error(e);
      }
      markDelivered(r.id, composed);
    }
    return { ok: true, data: { pending: pendingCount(), depts: evaluateDepts() } };
  } catch (e) {
    return fail(e, "配信に失敗しました。");
  }
}

export async function resetAction(): Promise<Result<null>> {
  resetStore();
  return { ok: true, data: null };
}

/** スタブ動作中かどうか。画面に明示するために使う。 */
export async function stubModeAction(): Promise<boolean> {
  return !process.env.ANTHROPIC_API_KEY;
}
