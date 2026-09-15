import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { blurSchema } from "./schemas";

// setup の「呼ばれたら throw する」モックを、このファイルだけ応答を返すモックで上書きする
const { create } = vi.hoisted(() => ({ create: vi.fn() }));

vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    messages = { create };
  },
}));

const reply = (text: string) => ({ content: [{ type: "text", text }] });

// client.ts は生成したクライアントを保持するので、テストごとに読み込み直す
const load = async () => (await import("./client")).callStructured;

beforeEach(() => {
  vi.resetModules();
  create.mockReset();
  vi.stubEnv("ANTHROPIC_API_KEY", "sk-test");
});

afterEach(() => {
  vi.stubEnv("ANTHROPIC_API_KEY", "");
});

describe("callStructured", () => {
  it("不正な JSON、型の合わない JSON の後に正しい JSON が返れば、再試行して成功する", async () => {
    create
      .mockResolvedValueOnce(reply("すみません、JSON ではありません"))
      .mockResolvedValueOnce(reply('{"wrong": 1}'))
      .mockResolvedValueOnce(reply('```json\n{"blurred": "ぼかした文面"}\n```'));
    const callStructured = await load();

    await expect(callStructured(blurSchema, "元のプロンプト")).resolves.toEqual({ blurred: "ぼかした文面" });
    expect(create).toHaveBeenCalledTimes(3);

    // 再試行では元のプロンプトに失敗の理由を添えて投げ直す
    const sent = create.mock.calls.map(([arg]) => arg.messages[0].content as string);
    expect(sent[0]).toBe("元のプロンプト");
    expect(sent[1]).toContain("元のプロンプト");
    expect(sent[1]).not.toBe(sent[0]);
  });

  it("3回とも不正なら throw する", async () => {
    create.mockResolvedValue(reply("not json"));
    const callStructured = await load();

    await expect(callStructured(blurSchema, "p")).rejects.toThrow(/構造化出力の取得に失敗/);
    expect(create).toHaveBeenCalledTimes(3);
  });

  it("maxRetries を 0 にすると再試行しない", async () => {
    create.mockResolvedValue(reply("not json"));
    const callStructured = await load();

    await expect(callStructured(blurSchema, "p", { maxRetries: 0 })).rejects.toThrow();
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("キーが無ければ SDK を呼ばずに throw する", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    const callStructured = await load();

    await expect(callStructured(blurSchema, "p")).rejects.toThrow(/ANTHROPIC_API_KEY/);
    expect(create).not.toHaveBeenCalled();
  });
});
