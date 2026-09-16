import "server-only";
import type { Composed, Severity } from "./ai/schemas";
import { USERS, userById } from "./data/users";
import { DEFAULT_SETTINGS, type Settings } from "./data/settings";
import { newId, supabase } from "./supabase";

/**
 * データアクセス層。Supabase(PostgreSQL) が保存先。
 *
 * 匿名性の構造的な担保:
 * 送信者 ID は reports テーブルにしかなく、受信者向けの型 InboxItem は
 * authorId を持たない。listInbox() は inbox_items ビューを読むだけで、
 * author_id を SELECT する経路が存在しない（supabase/schema.sql 参照）。
 */

export type ReportStatus = "pending" | "delivered" | "cancelled";

export type Report = {
  id: string;
  authorId: string;
  targetId: string | null;
  authorDept: string;
  severity: Severity;
  body: string;
  rawBody: string;
  hasContext: boolean;
  hasAction: boolean;
  status: ReportStatus;
  composed: Composed | null;
  response: "ack" | "dispute" | null;
  disputeNote: string | null;
  createdAt: string;
  deliveredAt: string | null;
  readAt: string | null;
  hrEscalated: boolean;
  retaliation: boolean;
};

/** 受信者に渡す形。送信者に関わるフィールドを持たない。 */
export type InboxItem = {
  id: string;
  body: string;
  hasContext: boolean;
  composed: Composed | null;
  response: "ack" | "dispute" | null;
};

/** 送信者が自分の送信を追跡するための形。相手の氏名は出すが、応答は要約のみ */
export type SentItem = {
  id: string;
  body: string;
  targetName: string | null;
  status: ReportStatus;
  createdAt: string;
  /** 読まれたか。送信者には「読まれました」だけ通知する（仕様書 5.4） */
  read: boolean;
  /** 相手が反論しているか。中身は本人が選んだときだけ見せる（仕様書 5.5） */
  hasDispute: boolean;
  disputeNote: string | null;
  severity: Severity;
};

/* eslint-disable @typescript-eslint/no-explicit-any */
type Row = any;

function toReport(r: Row): Report {
  return {
    id: r.id,
    authorId: r.author_id,
    targetId: r.target_id,
    authorDept: r.author_dept,
    severity: r.severity as Severity,
    body: r.body,
    rawBody: r.raw_body,
    hasContext: r.has_context,
    hasAction: r.has_action,
    status: r.status,
    composed: r.composed ?? null,
    response: r.response ?? null,
    disputeNote: r.dispute_note ?? null,
    createdAt: r.created_at,
    deliveredAt: r.delivered_at ?? null,
    readAt: r.read_at ?? null,
    hrEscalated: r.hr_escalated,
    retaliation: r.retaliation,
  };
}

/* ------------------------------------------------------------------ */
/*  申告                                                               */
/* ------------------------------------------------------------------ */

export type NewReport = {
  authorId: string;
  targetId: string | null;
  severity: Severity;
  body: string;
  rawBody: string;
  hasContext: boolean;
  hasAction: boolean;
};

export async function addReport(r: NewReport): Promise<Report> {
  const author = userById(r.authorId);
  const id = newId("rep");
  const { data, error } = await supabase()
    .from("reports")
    .insert({
      id,
      author_id: r.authorId,
      target_id: r.targetId,
      author_dept: author?.dept ?? "不明",
      severity: r.severity,
      body: r.body,
      raw_body: r.rawBody,
      has_context: r.hasContext,
      has_action: r.hasAction,
      status: "pending",
    })
    .select()
    .single();
  if (error) throw new Error(error.message);

  // 送信後のフォローアップを仕込む（仕様書 3.2）
  const now = Date.now();
  const day = 86_400_000;
  await supabase()
    .from("followups")
    .insert([
      { id: newId("fu"), report_id: id, stage: "d3", due_at: new Date(now + 3 * day).toISOString() },
      { id: newId("fu"), report_id: id, stage: "w2", due_at: new Date(now + 14 * day).toISOString() },
      { id: newId("fu"), report_id: id, stage: "m1", due_at: new Date(now + 30 * day).toISOString() },
    ]);

  return toReport(data);
}

/**
 * 受信箱。配信済みのものだけを、送信者情報を落とした形で返す。
 * inbox_items ビューには author_id が無いので、ここから辿ることはできない。
 */
export async function listInbox(userId: string): Promise<InboxItem[]> {
  const { data, error } = await supabase()
    .from("inbox_items")
    .select("id, body, has_context, composed, response")
    .eq("target_id", userId)
    .order("delivered_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []).map((r: Row) => ({
    id: r.id,
    body: r.body,
    hasContext: r.has_context,
    composed: r.composed ?? null,
    response: r.response ?? null,
  }));
}

/** 送信者が自分の送ったものを追跡する（仕様書 5.4 / 5.5） */
export async function listSent(authorId: string): Promise<SentItem[]> {
  const { data, error } = await supabase()
    .from("reports")
    .select("id, body, target_id, status, created_at, read_at, response, dispute_note, severity")
    .eq("author_id", authorId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []).map((r: Row) => ({
    id: r.id,
    body: r.body,
    targetName: r.target_id ? (userById(r.target_id)?.name ?? null) : null,
    status: r.status,
    createdAt: r.created_at,
    read: !!r.read_at,
    hasDispute: r.response === "dispute",
    disputeNote: r.dispute_note ?? null,
    severity: r.severity as Severity,
  }));
}

/** 配信前なら取り消せる（送信完了画面の文言どおり） */
export async function cancelReport(id: string, authorId: string): Promise<boolean> {
  const { data, error } = await supabase()
    .from("reports")
    .update({ status: "cancelled" })
    .eq("id", id)
    .eq("author_id", authorId)
    .eq("status", "pending")
    .select("id");
  if (error) throw new Error(error.message);
  return (data ?? []).length > 0;
}

/** レベル3の記述を、本人の同意があったときだけ HR へ引き継ぐ（仕様書 3.1） */
export async function escalateToHR(id: string, authorId: string): Promise<void> {
  const { error } = await supabase()
    .from("reports")
    .update({ hr_escalated: true })
    .eq("id", id)
    .eq("author_id", authorId);
  if (error) throw new Error(error.message);
}

/** レベル3は送信せず記録だけ残す。同意導線のために id を返す */
export async function recordLevel3(r: NewReport): Promise<string> {
  const author = userById(r.authorId);
  const id = newId("rep");
  const { error } = await supabase().from("reports").insert({
    id,
    author_id: r.authorId,
    target_id: r.targetId,
    author_dept: author?.dept ?? "不明",
    severity: 3,
    body: r.body,
    raw_body: r.rawBody,
    has_context: r.hasContext,
    has_action: r.hasAction,
    status: "cancelled",
  });
  if (error) throw new Error(error.message);
  return id;
}

export async function respond(
  id: string,
  kind: "ack" | "dispute",
  note?: string,
): Promise<void> {
  const { error } = await supabase()
    .from("reports")
    .update({
      response: kind,
      dispute_note: kind === "dispute" ? (note ?? null) : null,
      read_at: new Date().toISOString(),
    })
    .eq("id", id);
  if (error) throw new Error(error.message);
}

/** 受信者が開いた時点で既読にする。送信者には「読まれました」だけ伝わる */
export async function markRead(id: string): Promise<void> {
  await supabase()
    .from("reports")
    .update({ read_at: new Date().toISOString() })
    .eq("id", id)
    .is("read_at", null);
}

/* ------------------------------------------------------------------ */
/*  レート制限（仕様書 4.2）                                            */
/* ------------------------------------------------------------------ */

export type RateCheck = { allowed: boolean; reason?: string };

export async function checkRate(
  authorId: string,
  targetId: string | null,
): Promise<RateCheck> {
  const s = await getSettings();
  const since = new Date(Date.now() - 86_400_000).toISOString();

  let q = supabase()
    .from("reports")
    .select("id", { count: "exact", head: true })
    .eq("author_id", authorId)
    .neq("status", "cancelled")
    .gte("created_at", since);

  if (s.rateLimitUnit === "perTarget" && targetId) q = q.eq("target_id", targetId);

  const { count, error } = await q;
  if (error) throw new Error(error.message);

  if ((count ?? 0) >= s.rateLimitPerDay) {
    return {
      allowed: false,
      reason:
        s.rateLimitUnit === "perTarget"
          ? `同じ相手へは1日に ${s.rateLimitPerDay} 件までです。明日以降に送れます。`
          : `1日に送れるのは ${s.rateLimitPerDay} 件までです。明日以降に送れます。`,
    };
  }
  return { allowed: true };
}

/* ------------------------------------------------------------------ */
/*  配信                                                               */
/* ------------------------------------------------------------------ */

export async function pendingCount(): Promise<number> {
  const { count, error } = await supabase()
    .from("reports")
    .select("id", { count: "exact", head: true })
    .eq("status", "pending")
    .not("target_id", "is", null);
  if (error) throw new Error(error.message);
  return count ?? 0;
}

/**
 * 今回配信する分。受信者ごとに件数上限を設け、超過分は次回へ繰り越す（仕様書 5.1）。
 * まとめて大量に届くと、改善どころか防御や萎縮を招くため。
 */
export async function listForDelivery(): Promise<Report[]> {
  const s = await getSettings();
  const { data, error } = await supabase()
    .from("reports")
    .select("*")
    .eq("status", "pending")
    .not("target_id", "is", null)
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);

  const perTarget = new Map<string, number>();
  const batch: Report[] = [];
  for (const row of data ?? []) {
    const r = toReport(row);
    const n = perTarget.get(r.targetId!) ?? 0;
    if (n >= s.maxPerDelivery) continue;
    perTarget.set(r.targetId!, n + 1);
    batch.push(r);
  }
  return batch;
}

export async function markDelivered(id: string, composed: Composed | null): Promise<void> {
  const { error } = await supabase()
    .from("reports")
    .update({
      status: "delivered",
      composed,
      delivered_at: new Date().toISOString(),
    })
    .eq("id", id);
  if (error) throw new Error(error.message);
}

/** 繰り越された件数。管理者画面で「次回に回る分」を示す */
export async function carriedOverCount(): Promise<number> {
  const total = await pendingCount();
  const batch = await listForDelivery();
  return Math.max(0, total - batch.length);
}

/* ------------------------------------------------------------------ */
/*  閾値エスカレーション（仕様書 3.3）                                  */
/* ------------------------------------------------------------------ */

export type Escalation = {
  id: string;
  targetId: string;
  targetName: string;
  kind: "concrete" | "vague";
  reporterCount: number;
  createdAt: string;
};

/**
 * 閾値は人数ベース。回数ベースだと一人が繰り返し送って発火してしまう。
 * 具体的な行動が抽出できた申告は異なる2人、曖昧な申告は異なる3人以上かつ3ヶ月以内。
 */
export async function evaluateThresholds(): Promise<Escalation[]> {
  const s = await getSettings();
  const { data, error } = await supabase()
    .from("reports")
    .select("target_id, author_id, has_action, created_at")
    .not("target_id", "is", null)
    .neq("status", "cancelled");
  if (error) throw new Error(error.message);

  const windowStart = Date.now() - s.thresholdVagueWindowDays * 86_400_000;
  const concrete = new Map<string, Set<string>>();
  const vague = new Map<string, Set<string>>();

  for (const r of data ?? []) {
    const bucket = r.has_action ? concrete : vague;
    if (!r.has_action && new Date(r.created_at).getTime() < windowStart) continue;
    const set = bucket.get(r.target_id) ?? new Set<string>();
    set.add(r.author_id);
    bucket.set(r.target_id, set);
  }

  const fired: { targetId: string; kind: "concrete" | "vague"; n: number }[] = [];
  for (const [targetId, authors] of concrete) {
    if (authors.size >= s.thresholdConcrete) {
      fired.push({ targetId, kind: "concrete", n: authors.size });
    }
  }
  for (const [targetId, authors] of vague) {
    if (authors.size >= s.thresholdVague) {
      fired.push({ targetId, kind: "vague", n: authors.size });
    }
  }

  // 既に記録済みのものは作り直さない
  const { data: existing } = await supabase().from("escalations").select("target_id, kind");
  const seen = new Set((existing ?? []).map((e: Row) => `${e.target_id}:${e.kind}`));

  const rows = fired
    .filter((f) => !seen.has(`${f.targetId}:${f.kind}`))
    .map((f) => ({
      id: newId("esc"),
      target_id: f.targetId,
      kind: f.kind,
      reporter_count: f.n,
    }));

  if (rows.length > 0) await supabase().from("escalations").insert(rows);

  return listEscalations();
}

export async function listEscalations(): Promise<Escalation[]> {
  const { data, error } = await supabase()
    .from("escalations")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []).map((e: Row) => ({
    id: e.id,
    targetId: e.target_id,
    targetName: userById(e.target_id)?.name ?? "不明",
    kind: e.kind,
    reporterCount: e.reporter_count,
    createdAt: e.created_at,
  }));
}

/**
 * 自分が送った相手について、閾値が発火しているか。
 * 「あなた以外にも同様の申告がありました」の通知に使う（仕様書 3.3）。
 * 他の通報者が誰かは一切返さない。
 */
export async function escalationNoticeFor(authorId: string): Promise<string[]> {
  const { data: mine } = await supabase()
    .from("reports")
    .select("target_id")
    .eq("author_id", authorId)
    .not("target_id", "is", null)
    .neq("status", "cancelled");

  const myTargets = new Set((mine ?? []).map((r: Row) => r.target_id));
  if (myTargets.size === 0) return [];

  const escalations = await listEscalations();
  return escalations
    .filter((e) => myTargets.has(e.targetId))
    .map((e) => e.targetName);
}

/* ------------------------------------------------------------------ */
/*  部署アラート（仕様書 6.2）                                          */
/* ------------------------------------------------------------------ */

export type DeptAlert = {
  dept: string;
  /** 件数は画面に出さない。「複数の申告があります」とだけ表示する */
  summary: string;
};

/**
 * 対象者が特定されない申告の集積。
 * 母数下限を下回る部署では出さない。閾値発火それ自体が情報を漏らすため。
 */
export async function listDeptAlerts(): Promise<DeptAlert[]> {
  const s = await getSettings();
  const { data, error } = await supabase()
    .from("reports")
    .select("author_dept")
    .is("target_id", null)
    .neq("status", "cancelled");
  if (error) throw new Error(error.message);

  const counts = new Map<string, number>();
  for (const r of data ?? []) {
    counts.set(r.author_dept, (counts.get(r.author_dept) ?? 0) + 1);
  }

  const alerts: DeptAlert[] = [];
  for (const [dept, n] of counts) {
    const members = USERS.filter((u) => u.dept === dept).length;
    // 母数下限を満たさない部署は、集計を出さない
    if (members < s.deptAlertMinMembers) continue;
    if (n < 2) continue;
    alerts.push({
      dept,
      summary: `${dept}で、複数の申告が寄せられています。具体的な行為の特定には至っていません。`,
    });
  }
  return alerts;
}

/* ------------------------------------------------------------------ */
/*  管理者向けの部署評価（仕様書 6.1）                                  */
/* ------------------------------------------------------------------ */

export type DeptEval = {
  dept: string;
  level: number | null;
  label: string;
  detail: string;
};

export async function evaluateDepts(): Promise<DeptEval[]> {
  const { data, error } = await supabase()
    .from("reports")
    .select("target_id, severity, created_at")
    .not("target_id", "is", null)
    .neq("status", "cancelled");
  if (error) throw new Error(error.message);

  const all = data ?? [];
  return Array.from(new Set(USERS.map((u) => u.dept))).map((dept) => {
    const members = USERS.filter((u) => u.dept === dept).map((u) => u.id);
    const rs = all.filter((r: Row) => members.includes(r.target_id));

    // 申告ゼロは「データなし」。レベル1（安全）とは区別する
    if (rs.length === 0) {
      return { dept, level: null, label: "データなし", detail: "申告がありません" };
    }

    const heavy = rs.filter((r: Row) => r.severity >= 2).length;
    const ratio = heavy / rs.length;
    const targets = new Set(rs.map((r: Row) => r.target_id));
    const level = Math.min(5, 1 + Math.round(ratio * 2) + (rs.length >= 2 ? 1 : 0));
    const concentration = targets.size === 1 && rs.length > 1 ? "特定の1名に集中" : "複数名に分散";

    return {
      dept,
      level,
      label: `レベル ${level}`,
      detail: `重大度2以上が ${heavy}/${rs.length} ・ ${concentration}`,
    };
  });
}

/* ------------------------------------------------------------------ */
/*  フォローアップ（仕様書 3.2）                                        */
/* ------------------------------------------------------------------ */

export type PendingFollowup = {
  id: string;
  reportId: string;
  stage: "d3" | "w2" | "m1";
  question: string;
};

const STAGE_TEXT: Record<string, string> = {
  d3: "メッセージは届きました。何か変化はありましたか。",
  w2: "その後、状況はどうなっていますか。",
  m1: "その後、状況はどうなっていますか。",
};

export async function listDueFollowups(authorId: string): Promise<PendingFollowup[]> {
  const { data: mine } = await supabase()
    .from("reports")
    .select("id")
    .eq("author_id", authorId)
    .neq("status", "cancelled");
  const ids = (mine ?? []).map((r: Row) => r.id);
  if (ids.length === 0) return [];

  const { data, error } = await supabase()
    .from("followups")
    .select("*")
    .in("report_id", ids)
    .is("answered_at", null)
    .lte("due_at", new Date().toISOString());
  if (error) throw new Error(error.message);

  return (data ?? []).map((f: Row) => ({
    id: f.id,
    reportId: f.report_id,
    stage: f.stage,
    question: STAGE_TEXT[f.stage] ?? "状況はどうなっていますか。",
  }));
}

/**
 * 「悪化しました」が選ばれたら、新規のハラスメント相談ではなく報復事案として扱う。
 * 報復は元の行為より重いので、自動送信ルートには戻さない（仕様書 3.2）。
 */
export async function answerFollowup(
  id: string,
  answer: "improved" | "unchanged" | "worse",
): Promise<{ retaliation: boolean }> {
  const { data, error } = await supabase()
    .from("followups")
    .update({ answer, answered_at: new Date().toISOString() })
    .eq("id", id)
    .select("report_id")
    .single();
  if (error) throw new Error(error.message);

  if (answer === "worse" && data) {
    await supabase().from("reports").update({ retaliation: true }).eq("id", data.report_id);
    return { retaliation: true };
  }
  return { retaliation: false };
}

/** 緊急導線。フォローアップの時期を待たずに悪化を伝えられる */
export async function reportRetaliation(reportId: string, authorId: string): Promise<void> {
  const { error } = await supabase()
    .from("reports")
    .update({ retaliation: true })
    .eq("id", reportId)
    .eq("author_id", authorId);
  if (error) throw new Error(error.message);
}

export async function retaliationCount(): Promise<number> {
  const { count, error } = await supabase()
    .from("reports")
    .select("id", { count: "exact", head: true })
    .eq("retaliation", true);
  if (error) throw new Error(error.message);
  return count ?? 0;
}

/* ------------------------------------------------------------------ */
/*  企業設定（仕様書 6.3）                                              */
/* ------------------------------------------------------------------ */

export async function getSettings(): Promise<Settings> {
  const { data, error } = await supabase().from("settings").select("data").eq("id", 1).single();
  if (error || !data) return DEFAULT_SETTINGS;
  return { ...DEFAULT_SETTINGS, ...(data.data as Partial<Settings>) };
}

export async function saveSettings(
  next: Settings,
  actor: string,
  warned: boolean,
): Promise<void> {
  const current = await getSettings();

  const { error } = await supabase()
    .from("settings")
    .upsert({ id: 1, data: next });
  if (error) throw new Error(error.message);

  // いつ・誰が・何を変えたか、警告が出ていたかまで残す
  const logs = (Object.keys(next) as (keyof Settings)[])
    .filter((k) => String(current[k]) !== String(next[k]))
    .map((k) => ({
      id: newId("log"),
      actor,
      field: String(k),
      before_val: String(current[k]),
      after_val: String(next[k]),
      warned,
    }));

  if (logs.length > 0) await supabase().from("settings_log").insert(logs);
}

export type SettingsLogEntry = {
  id: string;
  changedAt: string;
  actor: string;
  field: string;
  before: string;
  after: string;
  warned: boolean;
};

export async function listSettingsLog(): Promise<SettingsLogEntry[]> {
  const { data, error } = await supabase()
    .from("settings_log")
    .select("*")
    .order("changed_at", { ascending: false })
    .limit(50);
  if (error) throw new Error(error.message);
  return (data ?? []).map((l: Row) => ({
    id: l.id,
    changedAt: l.changed_at,
    actor: l.actor,
    field: l.field,
    before: l.before_val,
    after: l.after_val,
    warned: l.warned,
  }));
}

/* ------------------------------------------------------------------ */
/*  検証用（仕様書 2.8）                                                */
/* ------------------------------------------------------------------ */

export type AuditEntry = {
  id: string;
  rawBody: string;
  body: string;
  composed: Composed | null;
  createdAt: string;
};

/**
 * 元の記述と整理後の文面を突き合わせる。
 * 「AI が誘導したのではないか」と争われたときに検証できるようにするためのもの。
 */
export async function listAudit(): Promise<AuditEntry[]> {
  const { data, error } = await supabase()
    .from("reports")
    .select("id, raw_body, body, composed, created_at")
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) throw new Error(error.message);
  return (data ?? []).map((r: Row) => ({
    id: r.id,
    rawBody: r.raw_body,
    body: r.body,
    composed: r.composed ?? null,
    createdAt: r.created_at,
  }));
}

/* ------------------------------------------------------------------ */
/*  デモ用                                                             */
/* ------------------------------------------------------------------ */

export async function resetStore(): Promise<void> {
  const sb = supabase();
  await sb.from("followups").delete().neq("id", "");
  await sb.from("escalations").delete().neq("id", "");
  await sb.from("dept_alerts").delete().neq("id", "");
  await sb.from("settings_log").delete().neq("id", "");
  await sb.from("reports").delete().neq("id", "");
  await sb.from("settings").upsert({ id: 1, data: DEFAULT_SETTINGS });

  const day = 86_400_000;
  await sb.from("reports").insert([
    {
      id: "rep_seed1",
      author_id: "u3",
      target_id: "u2",
      author_dept: "営業部",
      severity: 2,
      body: "先月の定例会議で、話している途中で話し始めることがありました。",
      raw_body: "先月の定例会議で、私が話している途中で話し始めることが3回ありました。",
      has_context: true,
      has_action: true,
      status: "delivered",
      composed: {
        what: "会議中、相手の発言の途中で話し始めることがありました。",
        why: "発言を最後まで聞かれない経験が続くと、相手は会議で意見を出すことをやめていきます。発言の機会が実質的に失われ、チームの意思決定に入る視点が減ります。",
        how: "相手が話し終えるまで一拍置く、話を遮ってしまったと気づいたら「続けてください」と戻す、といった対応が考えられます。",
      },
      created_at: new Date(Date.now() - 7 * day).toISOString(),
      delivered_at: new Date(Date.now() - 5 * day).toISOString(),
    },
    {
      id: "rep_seed2",
      author_id: "u4",
      target_id: "u2",
      author_dept: "開発部",
      severity: 1,
      body: "依頼のメッセージがいつも一言だけで、背景が分からないまま作業することがあります。",
      raw_body: "依頼のメッセージがいつも一言だけで、背景が分からないまま作業することがあります。",
      has_context: false,
      has_action: true,
      status: "pending",
      created_at: new Date(Date.now() - 2 * day).toISOString(),
    },
  ]);
}
