import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { analyze } from "@/lib/ai/analyze";
import { compose } from "@/lib/ai/compose";
import { resetStore } from "@/lib/store";
import {
  adminAction,
  analyzeAction,
  cancelAction,
  deliverAction,
  escalateAction,
  inboxAction,
  sendAction,
} from "./actions";

// 中身はスタブのまま動かし、呼ばれ方の確認と失敗の注入だけに使う
vi.mock(import("@/lib/ai/compose"), async (importOriginal) => {
  const m = await importOriginal();
  return { ...m, compose: vi.fn(m.compose) };
});
vi.mock(import("@/lib/ai/analyze"), async (importOriginal) => {
  const m = await importOriginal();
  return { ...m, analyze: vi.fn(m.analyze) };
});

const input = (over: Partial<Parameters<typeof sendAction>[0]> = {}): Parameters<typeof sendAction>[0] => ({
  authorId: "u1",
  targetId: "u2",
  severity: 1,
  body: "会議で遮られた",
  rawBody: "会議で遮られた",
  hasContext: true,
  ...over,
});

const admin = async () => {
  const r = await adminAction();
  if (!r.ok) throw new Error(r.error);
  return r.data;
};

beforeEach(() => {
  resetStore();
  // 失敗の注入を次のテストへ持ち越さない（mockReset は vi.fn に渡した元の実装へ戻す）
  vi.mocked(compose).mockReset();
  vi.mocked(analyze).mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("sendAction", () => {
  it("受け付けると id は r + UUID で、未配信件数が1つ増える", async () => {
    const before = (await admin()).pending;

    const r = await sendAction(input());

    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.id).toMatch(/^r[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    }
    expect((await admin()).pending).toBe(before + 1);
  });

  it("severity 3 はサーバー側でも拒否し、未配信件数は増えない", async () => {
    const before = await admin();

    const r = await sendAction(input({ severity: 3 }));

    expect(r).toEqual({ ok: false, error: expect.any(String) });
    expect(await admin()).toEqual(before);
  });
});

describe("cancelAction", () => {
  it("配信前なら取り消せ、未配信件数が戻る", async () => {
    const before = (await admin()).pending;
    const sent = await sendAction(input({ authorId: "u1" }));
    if (!sent.ok) throw new Error(sent.error);

    await expect(cancelAction("u1", sent.data.id)).resolves.toEqual({ ok: true, data: null });
    expect((await admin()).pending).toBe(before);
  });

  it("配信後は「すでに配信されたため取り消せません。」で失敗する", async () => {
    const sent = await sendAction(input({ authorId: "u1" }));
    if (!sent.ok) throw new Error(sent.error);
    await deliverAction();

    await expect(cancelAction("u1", sent.data.id)).resolves.toEqual({
      ok: false,
      error: "すでに配信されたため取り消せません。",
    });
  });

  it("他人の送信は取り消せない", async () => {
    const before = (await admin()).pending;
    const sent = await sendAction(input({ authorId: "u1" }));
    if (!sent.ok) throw new Error(sent.error);

    const r = await cancelAction("u3", sent.data.id);

    expect(r.ok).toBe(false);
    expect((await admin()).pending).toBe(before + 1);
  });
});

describe("escalateAction", () => {
  it("引き継ぐと管理者画面に氏名と原文が出て、匿名の集計には入らない", async () => {
    const before = await admin();

    const r = await escalateAction({ authorId: "u3", rawBody: "上司に殴られた", severityReason: "暴力" });

    expect(r.ok).toBe(true);
    const after = await admin();
    expect(after.escalations).toEqual([
      expect.objectContaining({ authorName: "鈴木 花子", rawBody: "上司に殴られた", severityReason: "暴力" }),
    ]);
    expect(after.pending).toBe(before.pending);
    expect(after.depts).toEqual(before.depts);
  });
});

describe("deliverAction", () => {
  it("文面の生成が失敗しても、composed を null にして配信済みにする", async () => {
    vi.mocked(compose).mockRejectedValue(new Error("API が落ちた"));
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    const sent = await sendAction(input({ targetId: "u4" }));
    if (!sent.ok) throw new Error(sent.error);

    const r = await deliverAction();

    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.pending).toBe(0);
    const inbox = await inboxAction("u4");
    expect(inbox).toEqual({
      ok: true,
      data: [expect.objectContaining({ id: sent.data.id, composed: null })],
    });
    expect(errorLog).toHaveBeenCalled();
  });

  it("生成できれば composed が付いて届く", async () => {
    const sent = await sendAction(input({ targetId: "u4" }));
    if (!sent.ok) throw new Error(sent.error);

    await deliverAction();

    const inbox = await inboxAction("u4");
    if (!inbox.ok) throw new Error(inbox.error);
    expect(inbox.data[0].composed).toEqual({
      what: expect.any(String),
      why: expect.any(String),
      how: expect.any(String),
    });
  });
});

describe("analyzeAction", () => {
  it("自分を対象者の候補から外す", async () => {
    const r = await analyzeAction("u2", "佐藤部長に会議で遮られた。");

    const names = vi.mocked(analyze).mock.calls[0][0].candidateNames;
    expect(names).not.toContain("佐藤 健一");
    expect(names).toHaveLength(5);
    // 候補に居ないので、本文に自分の名前があっても対象者にならない
    expect(r.ok && r.data.targetHint).toBeNull();
  });

  it("他人が書けば、本文の名前が対象者として読み取られる", async () => {
    const r = await analyzeAction("u3", "佐藤部長に会議で遮られた。");
    expect(r.ok && r.data.targetHint).toBe("佐藤 健一");
  });
});
