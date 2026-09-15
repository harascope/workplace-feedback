import "server-only";
import type { Composed, Severity } from "./ai/schemas";
import { USERS } from "./data/users";

/**
 * デモ用のインメモリストア。開発サーバーの再起動で消える。
 *
 * 匿名性の構造的な担保:
 * 送信者 ID は Report にしか存在しない。受信者向けの型 InboxItem は authorId を
 * 持たず、listInbox() は authorId を読まずに組み立てる。受信画面へ渡る値に
 * 送信者の情報が混ざる経路を、型のレベルで塞いでいる。
 */

export type Report = {
  id: string;
  authorId: string;
  targetId: string;
  severity: Severity;
  /** 送信者が確認した、整理後の文面 */
  body: string;
  /** 元の記述。検証のため保存する（仕様書 2.8）。受信画面には出さない */
  rawBody: string;
  /** 場面が抽出できたか。受信側の補足表示に使う */
  hasContext: boolean;
  status: "pending" | "delivered";
  composed: Composed | null;
  response: "ack" | "dispute" | null;
  createdAt: number;
};

/** 受信者に渡す形。送信者に関わるフィールドを持たない。 */
export type InboxItem = {
  id: string;
  body: string;
  hasContext: boolean;
  composed: Composed | null;
  response: "ack" | "dispute" | null;
};

const seed = (): Report[] => [
  {
    id: "r0",
    authorId: "u3",
    targetId: "u2",
    severity: 2,
    body: "先月の定例会議で、話している途中で話し始めることがありました。",
    rawBody: "先月の定例会議で、私が話している途中で話し始めることが3回ありました。",
    hasContext: true,
    status: "delivered",
    composed: {
      what: "会議中、相手の発言の途中で話し始めることがありました。",
      why: "発言を最後まで聞かれない経験が続くと、相手は会議で意見を出すことをやめていきます。発言の機会が実質的に失われ、チームの意思決定に入る視点が減ります。",
      how: "相手が話し終えるまで一拍置く、話を遮ってしまったと気づいたら「続けてください」と戻す、といった対応が考えられます。",
    },
    response: null,
    createdAt: Date.now() - 86400_000 * 7,
  },
  {
    id: "r1",
    authorId: "u4",
    targetId: "u2",
    severity: 1,
    body: "依頼のメッセージがいつも一言だけで、背景が分からないまま作業することがあります。",
    rawBody: "依頼のメッセージがいつも一言だけで、背景が分からないまま作業することがあります。",
    hasContext: false,
    status: "pending",
    composed: null,
    response: null,
    createdAt: Date.now() - 86400_000 * 2,
  },
];

// dev の HMR をまたいで保持する
const g = globalThis as unknown as { __reports?: Report[] };
g.__reports ??= seed();
const reports = (): Report[] => g.__reports!;

export function addReport(
  r: Omit<Report, "id" | "status" | "composed" | "response" | "createdAt">,
): Report {
  const report: Report = {
    ...r,
    id: `r${Date.now()}`,
    status: "pending",
    composed: null,
    response: null,
    createdAt: Date.now(),
  };
  reports().push(report);
  return report;
}

/**
 * 受信箱。配信済みのものだけを、送信者情報を落とした形で返す。
 * authorId を参照しないこと。
 */
export function listInbox(userId: string): InboxItem[] {
  return reports()
    .filter((r) => r.targetId === userId && r.status === "delivered")
    .map(({ id, body, hasContext, composed, response }) => ({
      id,
      body,
      hasContext,
      composed,
      response,
    }));
}

export function pendingCount(): number {
  return reports().filter((r) => r.status === "pending").length;
}

export function listPending(): Report[] {
  return reports().filter((r) => r.status === "pending");
}

export function markDelivered(id: string, composed: Composed | null): void {
  const r = reports().find((x) => x.id === id);
  if (!r) return;
  r.status = "delivered";
  r.composed = composed;
}

export function respond(id: string, kind: "ack" | "dispute"): void {
  const r = reports().find((x) => x.id === id);
  if (r) r.response = kind;
}

export function resetStore(): void {
  g.__reports = seed();
}

/** 管理者向けの部署評価。申告ゼロは「データなし」で、レベル1とは区別する（仕様書 6.1）。 */
export type DeptEval = {
  dept: string;
  level: number | null;
  label: string;
  detail: string;
};

export function evaluateDepts(): DeptEval[] {
  const all = reports();
  return Array.from(new Set(USERS.map((u) => u.dept))).map((dept) => {
    const members = USERS.filter((u) => u.dept === dept).map((u) => u.id);
    const rs = all.filter((r) => members.includes(r.targetId));

    if (rs.length === 0) {
      return { dept, level: null, label: "データなし", detail: "申告がありません" };
    }

    const heavy = rs.filter((r) => r.severity >= 2).length;
    const ratio = heavy / rs.length;
    const targets = new Set(rs.map((r) => r.targetId));
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
