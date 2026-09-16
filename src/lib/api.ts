import "server-only";
import { headers } from "next/headers";
import { z } from "zod";
import { composedSchema, severitySchema, type Analysis, type Severity } from "@/lib/ai/schemas";

/**
 * FastAPI（api）を呼ぶ薄いクライアント。契約は docs/api.md（唯一の拠り所）。
 *
 * api は snake_case、こちら側は camelCase。変換はこのファイルに閉じる。
 * 応答は zod で検証してから返すので、api 側の形が変わってもここで止まり、画面までは壊れない。
 */

const API_BASE_URL = process.env.API_BASE_URL ?? "http://api:8000";

const FALLBACK_CLIENT_ID = "unknown";

/**
 * ブラウザ側の利用者を識別する値（docs/api.md「レート制限」節）。
 *
 * api は web コンテナからしか呼ばれないため、api 側から見た送信元は常に web になる。
 * api 側でレート制限を利用者単位にできるよう、ここで X-Client-Id ヘッダとして渡す。
 * Cloudflare 経由なら cf-connecting-ip が最も信頼できるのでそれを優先し、
 * 無ければ x-forwarded-for（先頭の1件）、どちらも取れなければ固定値にフォールバックする。
 */
async function clientId(): Promise<string> {
  try {
    const h = await headers();
    const cfIp = h.get("cf-connecting-ip");
    if (cfIp) return cfIp.trim();
    const forwardedFor = h.get("x-forwarded-for");
    if (forwardedFor) return forwardedFor.split(",")[0]!.trim() || FALLBACK_CLIENT_ID;
    return FALLBACK_CLIENT_ID;
  } catch {
    return FALLBACK_CLIENT_ID;
  }
}

/** api からのエラー応答。detail を message にそのまま載せる（docs/api.md: web 側はこの detail をそのまま画面に出す） */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    detail: string,
  ) {
    super(detail);
    this.name = "ApiError";
  }
}

async function detailOf(res: Response): Promise<string | undefined> {
  try {
    const j: unknown = await res.json();
    if (j && typeof j === "object" && typeof (j as { detail?: unknown }).detail === "string") {
      return (j as { detail: string }).detail;
    }
  } catch {
    // JSON でなければ detail は無い（slowapi のレート制限応答など）
  }
  return undefined;
}

async function call<T>(path: string, schema: z.ZodType<T, z.ZodTypeDef, unknown>, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", "X-Client-Id": await clientId(), ...init?.headers },
    cache: "no-store",
  });

  if (!res.ok) {
    throw new ApiError(res.status, (await detailOf(res)) ?? `通信に失敗しました（${res.status}）`);
  }
  if (res.status === 204) return undefined as T;
  return schema.parse(await res.json());
}

// ---- GET /meta ----

const metaSchema = z.object({ stub: z.boolean() });

export async function getMeta(): Promise<{ stub: boolean }> {
  return call("/meta", metaSchema);
}

// ---- POST /analyze ----

const analyzeResSchema = z
  .object({
    actions: z.array(z.object({ description: z.string(), observable: z.boolean() })),
    context: z.string().nullable(),
    target_hint: z.string().nullable(),
    severity: severitySchema,
    severity_reason: z.string(),
    identifiability: z.enum(["low", "medium", "high"]),
    identifiability_reason: z.string(),
    organized: z.string(),
    rephrase_hint: z.string().nullable().default(null),
  })
  .transform(
    (r): Analysis => ({
      actions: r.actions,
      context: r.context,
      targetHint: r.target_hint,
      severity: r.severity,
      severityReason: r.severity_reason,
      identifiability: r.identifiability,
      identifiabilityReason: r.identifiability_reason,
      organized: r.organized,
      rephraseHint: r.rephrase_hint,
    }),
  );

export async function analyze(meId: string, body: string): Promise<Analysis> {
  return call("/analyze", analyzeResSchema, {
    method: "POST",
    body: JSON.stringify({ me_id: meId, body }),
  });
}

// ---- POST /blur ----

const blurResSchema = z.object({ text: z.string() });

export async function blur(text: string): Promise<string> {
  const r = await call("/blur", blurResSchema, { method: "POST", body: JSON.stringify({ text }) });
  return r.text;
}

// ---- POST /reports, DELETE /reports/{id} ----

const createReportResSchema = z.object({ id: z.string() });

export async function createReport(input: {
  authorId: string;
  targetId: string;
  severity: Severity;
  body: string;
  rawBody: string;
  hasContext: boolean;
}): Promise<{ id: string }> {
  return call("/reports", createReportResSchema, {
    method: "POST",
    body: JSON.stringify({
      author_id: input.authorId,
      target_id: input.targetId,
      severity: input.severity,
      body: input.body,
      raw_body: input.rawBody,
      has_context: input.hasContext,
    }),
  });
}

export async function cancelReport(id: string, authorId: string): Promise<void> {
  await call<undefined>(`/reports/${encodeURIComponent(id)}?author_id=${encodeURIComponent(authorId)}`, z.undefined(), {
    method: "DELETE",
  });
}

// ---- GET /inbox/{user_id}, POST /reports/{id}/response ----

export type InboxItem = {
  id: string;
  body: string;
  hasContext: boolean;
  composed: z.infer<typeof composedSchema> | null;
  response: "ack" | "dispute" | null;
};

const inboxResSchema = z.array(
  z
    .object({
      id: z.string(),
      body: z.string(),
      has_context: z.boolean(),
      composed: composedSchema.nullable(),
      response: z.enum(["ack", "dispute"]).nullable(),
    })
    .transform(
      (x): InboxItem => ({ id: x.id, body: x.body, hasContext: x.has_context, composed: x.composed, response: x.response }),
    ),
);

export async function getInbox(userId: string): Promise<InboxItem[]> {
  return call(`/inbox/${encodeURIComponent(userId)}`, inboxResSchema);
}

export async function respond(id: string, kind: "ack" | "dispute"): Promise<void> {
  await call<undefined>(`/reports/${encodeURIComponent(id)}/response`, z.undefined(), {
    method: "POST",
    body: JSON.stringify({ kind }),
  });
}

// ---- GET /admin, POST /admin/deliver ----

export type DeptEval = {
  dept: string;
  level: number | null;
  label: string;
  detail: string;
  /** 在籍人数。母数下限の説明に使う。申告の件数ではない */
  memberCount: number;
  /** 母数下限に満たないか（仕様書 6.2）。満たないなら部署単位のアラートを出さない */
  belowMinMembers: boolean;
  /** 部署アラートが出ているか（仕様書 6.2）。件数は出さない */
  alert: boolean;
};

export type AdminView = {
  pending: number;
  depts: DeptEval[];
  escalations: {
    id: string;
    authorName: string;
    rawBody: string;
    severityReason: string;
    /** epoch ミリ秒。api は ISO 文字列で返すが、画面側の型（Date.now() 由来）に合わせて変換する */
    createdAt: number;
  }[];
  /** 配信済みの重大度の内訳。全社の合計のみで、部署 × 重大度の表は作らない */
  severityMix: { level1: number; level2: number };
  delivery: {
    /** 次のまとめ配信。epoch ミリ秒 */
    nextAt: number;
    intervalDays: number;
    /** いちばん古い未配信が待っている日数。未配信が無ければ null */
    oldestPendingDays: number | null;
    deliveredTotal: number;
  };
  /** 部署評価の段階数。5 が最も危険（仕様書 6.1） */
  levelMax: number;
  /** 部署アラートを出す母数の下限（仕様書 6.2） */
  deptAlertMinMembers: number;
};

const adminResSchema = z
  .object({
    pending: z.number(),
    depts: z.array(
      z.object({
        dept: z.string(),
        level: z.number().nullable(),
        label: z.string(),
        detail: z.string(),
        member_count: z.number(),
        below_min_members: z.boolean(),
        alert: z.boolean(),
      }),
    ),
    escalations: z.array(
      z.object({
        id: z.string(),
        author_name: z.string(),
        raw_body: z.string(),
        severity_reason: z.string(),
        created_at: z.string(),
      }),
    ),
    severity_mix: z.object({ level1: z.number(), level2: z.number() }),
    delivery: z.object({
      next_at: z.string(),
      interval_days: z.number(),
      oldest_pending_days: z.number().nullable(),
      delivered_total: z.number(),
    }),
    level_max: z.number(),
    dept_alert_min_members: z.number(),
  })
  .transform(
    (r): AdminView => ({
      pending: r.pending,
      depts: r.depts.map((d) => ({
        dept: d.dept,
        level: d.level,
        label: d.label,
        detail: d.detail,
        memberCount: d.member_count,
        belowMinMembers: d.below_min_members,
        alert: d.alert,
      })),
      escalations: r.escalations.map((e) => ({
        id: e.id,
        authorName: e.author_name,
        rawBody: e.raw_body,
        severityReason: e.severity_reason,
        // epoch ミリ秒。api は ISO 文字列で返すが、画面側の型（Date.now() 由来）に合わせて変換する
        createdAt: new Date(e.created_at).getTime(),
      })),
      severityMix: r.severity_mix,
      delivery: {
        nextAt: new Date(r.delivery.next_at).getTime(),
        intervalDays: r.delivery.interval_days,
        oldestPendingDays: r.delivery.oldest_pending_days,
        deliveredTotal: r.delivery.delivered_total,
      },
      levelMax: r.level_max,
      deptAlertMinMembers: r.dept_alert_min_members,
    }),
  );

export async function getAdmin(): Promise<AdminView> {
  return call("/admin", adminResSchema);
}

export async function deliver(): Promise<AdminView> {
  return call("/admin/deliver", adminResSchema, { method: "POST" });
}

// ---- POST /escalations, POST /admin/reset ----

const createEscalationResSchema = z.object({ id: z.string() });

export async function createEscalation(input: {
  authorId: string;
  rawBody: string;
  severityReason: string;
}): Promise<void> {
  await call("/escalations", createEscalationResSchema, {
    method: "POST",
    body: JSON.stringify({ author_id: input.authorId, raw_body: input.rawBody, severity_reason: input.severityReason }),
  });
}

export async function resetDemo(): Promise<void> {
  await call<undefined>("/admin/reset", z.undefined(), { method: "POST" });
}

/** デモ用のサンプルデータを入れる。/admin/reset とは別経路（reset の件数は E2E が依存している） */
export async function seedDemo(): Promise<AdminView> {
  return call("/admin/seed-demo", adminResSchema, { method: "POST" });
}
