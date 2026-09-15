import { beforeEach, describe, expect, it } from "vitest";
import {
  addEscalation,
  addReport,
  cancelReport,
  evaluateDepts,
  listEscalations,
  listInbox,
  listPending,
  markDelivered,
  pendingCount,
  resetStore,
  respond,
} from "./store";
import { USERS } from "./data/users";

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/;

const draft = (over: Partial<Parameters<typeof addReport>[0]> = {}) => ({
  authorId: "u1",
  targetId: "u2",
  severity: 1 as const,
  body: "整理後の文面",
  rawBody: "元の記述",
  hasContext: true,
  ...over,
});

const dept = (name: string) => evaluateDepts().find((d) => d.dept === name)!;

beforeEach(() => {
  resetStore();
});

describe("addReport", () => {
  it("id は r + UUID で、送信時刻を含まない。未配信として入る", () => {
    const r = addReport(draft());

    expect(r.id).toMatch(new RegExp(`^r${UUID.source}$`));
    expect(r.id).not.toMatch(/^r\d{13}$/);
    expect(r.status).toBe("pending");
    expect(listPending().map((x) => x.id)).toContain(r.id);
  });

  it("続けて足しても id が重複しない", () => {
    const ids = Array.from({ length: 20 }, () => addReport(draft()).id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("listInbox", () => {
  it("配信済みで、自分あてのものだけを返す", () => {
    const pendingToU2 = addReport(draft({ targetId: "u2" }));
    const deliveredToU1 = addReport(draft({ targetId: "u1", authorId: "u3" }));
    markDelivered(deliveredToU1.id, null);

    const ids = listInbox("u2").map((x) => x.id);

    expect(ids).toEqual(["r0"]);
    expect(ids).not.toContain(pendingToU2.id);
    expect(listInbox("u1").map((x) => x.id)).toEqual([deliveredToU1.id]);
  });

  it("送信者を特定できる値を受信者に渡さない", () => {
    const r = addReport(draft({ authorId: "u5", targetId: "u4", rawBody: "送信者だけが知る元の記述" }));
    markDelivered(r.id, null);

    for (const user of USERS) {
      for (const item of listInbox(user.id)) {
        expect(Object.keys(item)).not.toContain("authorId");
        expect(Object.keys(item)).not.toContain("rawBody");
        expect(Object.keys(item)).not.toContain("createdAt");
      }
    }
    const json = JSON.stringify(listInbox("u4"));
    expect(json).not.toContain("u5");
    expect(json).not.toContain("送信者だけが知る元の記述");
  });

  it("応答すると受信箱に反映される", () => {
    respond("r0", "dispute");
    expect(listInbox("u2")[0].response).toBe("dispute");
  });
});

describe("cancelReport", () => {
  it("本人のもので未配信なら取り消せ、一覧から消える", () => {
    const r = addReport(draft({ authorId: "u1" }));
    const before = pendingCount();

    expect(cancelReport(r.id, "u1")).toBe(true);
    expect(pendingCount()).toBe(before - 1);
    expect(listPending().map((x) => x.id)).not.toContain(r.id);
    // 2回目は対象がもう無い
    expect(cancelReport(r.id, "u1")).toBe(false);
  });

  it("他人のものは取り消せず、残る", () => {
    const r = addReport(draft({ authorId: "u1" }));

    expect(cancelReport(r.id, "u3")).toBe(false);
    expect(listPending().map((x) => x.id)).toContain(r.id);
  });

  it("配信済みのものは本人でも取り消せない", () => {
    const r = addReport(draft({ authorId: "u1", targetId: "u2" }));
    markDelivered(r.id, null);

    expect(cancelReport(r.id, "u1")).toBe(false);
    expect(listInbox("u2").map((x) => x.id)).toContain(r.id);
    // 初期データの配信済み申告も同じ
    expect(cancelReport("r0", "u3")).toBe(false);
  });

  it("存在しない id は false", () => {
    expect(cancelReport("r-missing", "u1")).toBe(false);
  });
});

describe("addEscalation / listEscalations", () => {
  it("引き継ぎは受信箱・未配信件数・部署評価のどれにも出ない", () => {
    const depts = evaluateDepts();
    const pending = pendingCount();
    const inboxes = USERS.map((u) => listInbox(u.id));

    const e = addEscalation({ authorId: "u3", rawBody: "佐藤部長に殴られた", severityReason: "暴力" });

    expect(e.id).toMatch(new RegExp(`^e${UUID.source}$`));
    expect(listEscalations()).toEqual([e]);
    expect(evaluateDepts()).toEqual(depts);
    expect(pendingCount()).toBe(pending);
    expect(USERS.map((u) => listInbox(u.id))).toEqual(inboxes);
  });

  it("resetStore で空になる", () => {
    addEscalation({ authorId: "u3", rawBody: "x", severityReason: "y" });
    resetStore();
    expect(listEscalations()).toEqual([]);
  });
});

describe("evaluateDepts", () => {
  it("初期データ: 営業部は配信済み1件だけを数え、集中・分散は付けない", () => {
    const sales = dept("営業部");

    expect(sales.level).toBe(3);
    expect(sales.label).toBe("レベル 3");
    expect(sales.detail).toBe("重大度2以上が 1/1");
    expect(sales.detail).not.toMatch(/集中|分散/);
  });

  it("申告の無い部署は「データなし」で、レベルを持たない", () => {
    const dev = dept("開発部");

    expect(dev.label).toBe("データなし");
    expect(dev.level).toBeNull();
  });

  it("未配信の申告を足しても結果は変わらない", () => {
    const before = evaluateDepts();

    addReport(draft({ targetId: "u2", severity: 2 }));
    addReport(draft({ targetId: "u4", severity: 2 }));

    expect(evaluateDepts()).toEqual(before);
  });

  it("配信すると反映され、同じ相手なら「特定の1名に集中」", () => {
    const r = addReport(draft({ targetId: "u2", severity: 1 }));
    markDelivered(r.id, null);

    expect(dept("営業部").detail).toBe("重大度2以上が 1/2 ・ 特定の1名に集中");
  });

  it("配信済みの相手が複数なら「複数名に分散」", () => {
    const r = addReport(draft({ authorId: "u3", targetId: "u1", severity: 1 }));
    markDelivered(r.id, null);

    expect(dept("営業部").detail).toBe("重大度2以上が 1/2 ・ 複数名に分散");
  });

  it("別部署への配信は、その部署だけを動かす", () => {
    const r = addReport(draft({ targetId: "u4", severity: 2 }));
    markDelivered(r.id, null);

    expect(dept("開発部").level).not.toBeNull();
    expect(dept("開発部").detail).toBe("重大度2以上が 1/1");
    expect(dept("管理部").level).toBeNull();
    expect(dept("営業部").detail).toBe("重大度2以上が 1/1");
  });
});

describe("存在しない id", () => {
  it("markDelivered と respond は何もしない", () => {
    const depts = evaluateDepts();
    const pending = listPending();
    const inboxes = USERS.map((u) => listInbox(u.id));

    expect(() => markDelivered("r-missing", null)).not.toThrow();
    expect(() => respond("r-missing", "ack")).not.toThrow();

    expect(evaluateDepts()).toEqual(depts);
    expect(listPending()).toEqual(pending);
    expect(USERS.map((u) => listInbox(u.id))).toEqual(inboxes);
  });
});
