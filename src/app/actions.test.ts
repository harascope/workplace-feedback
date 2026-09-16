import { beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "@/lib/api";
import {
  adminAction,
  analyzeAction,
  blurAction,
  cancelAction,
  deliverAction,
  escalateAction,
  inboxAction,
  resetAction,
  respondAction,
  seedDemoAction,
  sendAction,
  stubModeAction,
  type AdminView,
} from "./actions";

// api.ts をまるごと差し替える。呼ばれ方の確認と、成功/失敗の変換だけをテストする
vi.mock("@/lib/api", () => ({
  ApiError: class ApiError extends Error {
    status: number;
    constructor(status: number, detail: string) {
      super(detail);
      this.status = status;
    }
  },
  analyze: vi.fn(),
  blur: vi.fn(),
  createReport: vi.fn(),
  cancelReport: vi.fn(),
  createEscalation: vi.fn(),
  getInbox: vi.fn(),
  respond: vi.fn(),
  getAdmin: vi.fn(),
  deliver: vi.fn(),
  resetDemo: vi.fn(),
  seedDemo: vi.fn(),
  getMeta: vi.fn(),
}));

const analysis = {
  actions: [{ description: "会議で発言を遮られた", observable: true }],
  context: "定例会議",
  targetHint: "山田 太郎",
  severity: 1 as const,
  severityReason: "単発の言動",
  identifiability: "low" as const,
  identifiabilityReason: "",
  organized: "会議で発言を遮られた。",
};

const adminView: AdminView = {
  pending: 1,
  depts: [],
  escalations: [],
  severityMix: { level1: 0, level2: 0 },
  delivery: {
    nextAt: Date.parse("2026-09-21T00:00:00Z"),
    intervalDays: 7,
    oldestPendingDays: null,
    deliveredTotal: 0,
  },
  levelMax: 5,
  deptAlertMinMembers: 3,
};

beforeEach(() => {
  vi.resetAllMocks();
});

describe("analyzeAction", () => {
  it("成功すると api.analyze の結果をそのまま渡す", async () => {
    vi.mocked(api.analyze).mockResolvedValue(analysis);

    const r = await analyzeAction("u3", "会議で山田さんに発言を遮られた");

    expect(api.analyze).toHaveBeenCalledWith("u3", "会議で山田さんに発言を遮られた");
    expect(r).toEqual({ ok: true, data: analysis });
  });

  it("ApiError なら detail をそのまま error にする", async () => {
    vi.mocked(api.analyze).mockRejectedValue(new api.ApiError(502, "解析に失敗しました。もう一度お試しください。"));
    vi.spyOn(console, "error").mockImplementation(() => {});

    const r = await analyzeAction("u3", "本文");

    expect(r).toEqual({ ok: false, error: "解析に失敗しました。もう一度お試しください。" });
  });

  it("api に届かないなどの一般エラーはフォールバック文言にする", async () => {
    vi.mocked(api.analyze).mockRejectedValue(new TypeError("fetch failed"));
    vi.spyOn(console, "error").mockImplementation(() => {});

    const r = await analyzeAction("u3", "本文");

    expect(r).toEqual({ ok: false, error: "解析に失敗しました。もう一度お試しください。" });
  });
});

describe("blurAction", () => {
  it("成功すると書き直した文字列を渡す", async () => {
    vi.mocked(api.blur).mockResolvedValue("ぼかした文面");

    const r = await blurAction("元の文面");

    expect(r).toEqual({ ok: true, data: "ぼかした文面" });
  });
});

describe("sendAction", () => {
  const input = {
    authorId: "u1",
    targetId: "u2",
    severity: 1 as const,
    body: "会議で遮られた",
    rawBody: "会議で遮られた",
    hasContext: true,
  };

  it("severity 3 は api を呼ばずに拒否する", async () => {
    const r = await sendAction({ ...input, severity: 3 });

    expect(r).toEqual({ ok: false, error: "この内容はこのツールでは送信できません。" });
    expect(api.createReport).not.toHaveBeenCalled();
  });

  it("成功すると id を渡す", async () => {
    vi.mocked(api.createReport).mockResolvedValue({ id: "r-1" });

    const r = await sendAction(input);

    expect(api.createReport).toHaveBeenCalledWith(input);
    expect(r).toEqual({ ok: true, data: { id: "r-1" } });
  });
});

describe("cancelAction", () => {
  it("成功すると null を渡す", async () => {
    vi.mocked(api.cancelReport).mockResolvedValue(undefined);

    await expect(cancelAction("u1", "r-1")).resolves.toEqual({ ok: true, data: null });
    expect(api.cancelReport).toHaveBeenCalledWith("r-1", "u1");
  });

  it("409（配信済み・本人でない・存在しない）は detail をそのまま出す", async () => {
    vi.mocked(api.cancelReport).mockRejectedValue(new api.ApiError(409, "すでに配信されたため取り消せません。"));
    vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(cancelAction("u1", "r-1")).resolves.toEqual({
      ok: false,
      error: "すでに配信されたため取り消せません。",
    });
  });
});

describe("escalateAction", () => {
  it("成功すると null を渡す", async () => {
    vi.mocked(api.createEscalation).mockResolvedValue(undefined);

    const input = { authorId: "u3", rawBody: "上司に殴られた", severityReason: "暴力" };
    await expect(escalateAction(input)).resolves.toEqual({ ok: true, data: null });
    expect(api.createEscalation).toHaveBeenCalledWith(input);
  });
});

describe("inboxAction / respondAction", () => {
  it("inboxAction は api.getInbox の結果をそのまま渡す", async () => {
    const items = [{ id: "r-1", body: "本文", hasContext: true, composed: null, response: null }];
    vi.mocked(api.getInbox).mockResolvedValue(items);

    await expect(inboxAction("u2")).resolves.toEqual({ ok: true, data: items });
  });

  it("respondAction は成功すると null を渡す", async () => {
    vi.mocked(api.respond).mockResolvedValue(undefined);

    await expect(respondAction("r-1", "ack")).resolves.toEqual({ ok: true, data: null });
    expect(api.respond).toHaveBeenCalledWith("r-1", "ack");
  });
});

describe("adminAction / deliverAction", () => {
  it("adminAction は api.getAdmin の結果をそのまま渡す", async () => {
    vi.mocked(api.getAdmin).mockResolvedValue(adminView);

    await expect(adminAction()).resolves.toEqual({ ok: true, data: adminView });
  });

  it("deliverAction は api.deliver の結果をそのまま渡す", async () => {
    const delivered = { ...adminView, pending: 0 };
    vi.mocked(api.deliver).mockResolvedValue(delivered);

    await expect(deliverAction()).resolves.toEqual({ ok: true, data: delivered });
  });
});

describe("resetAction", () => {
  it("成功すると null を渡す", async () => {
    vi.mocked(api.resetDemo).mockResolvedValue(undefined);

    await expect(resetAction()).resolves.toEqual({ ok: true, data: null });
  });
});

describe("seedDemoAction", () => {
  it("api.seedDemo の結果をそのまま渡す", async () => {
    const seeded = { ...adminView, pending: 8 };
    vi.mocked(api.seedDemo).mockResolvedValue(seeded);

    await expect(seedDemoAction()).resolves.toEqual({ ok: true, data: seeded });
    // 初期化とは別経路。reset の件数は E2E が依存しているので混ぜない
    expect(api.resetDemo).not.toHaveBeenCalled();
  });

  it("失敗はフォールバック文言にする", async () => {
    vi.mocked(api.seedDemo).mockRejectedValue(new TypeError("fetch failed"));
    vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(seedDemoAction()).resolves.toEqual({
      ok: false,
      error: "デモ用データの投入に失敗しました。",
    });
  });
});

describe("stubModeAction", () => {
  it("api.getMeta の stub をそのまま返す", async () => {
    vi.mocked(api.getMeta).mockResolvedValue({ stub: true });

    await expect(stubModeAction()).resolves.toBe(true);
  });

  it("api に届かないときは false にする（通知バナーを誤って出さない）", async () => {
    vi.mocked(api.getMeta).mockRejectedValue(new TypeError("fetch failed"));
    vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(stubModeAction()).resolves.toBe(false);
  });
});
