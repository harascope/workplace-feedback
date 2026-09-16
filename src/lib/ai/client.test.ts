import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { blurSchema } from "./schemas";

// setup の「呼ばれたら throw する」モックを、このファイルだけ応答を返すモックで上書きする
const { generateContent } = vi.hoisted(() => ({ generateContent: vi.fn() }));

vi.mock("@google/genai", () => ({
  GoogleGenAI: class {
    models = { generateContent };
  },
}));

const reply = (text: string) => ({ text });

// client.ts は生成したクライアントを保持するので、テストごとに読み込み直す
const load = async () => (await import("./client")).callStructured;

beforeEach(() => {
  vi.resetModules();
  generateContent.mockReset();
  vi.stubEnv("GEMINI_API_KEY", "test-key");
});

afterEach(() => {
  vi.stubEnv("GEMINI_API_KEY", "");
});

describe("callStructured", () => {
  it("不正な JSON、型の合わない JSON の後に正しい JSON が返れば、再試行して成功する", async () => {
    generateContent
      .mockResolvedValueOnce(reply("すみません、JSON ではありません"))
      .mockResolvedValueOnce(reply('{"wrong": 1}'))
      .mockResolvedValueOnce(reply('```json\n{"blurred": "ぼかした文面"}\n```'));
    const callStructured = await load();

    await expect(callStructured(blurSchema, "元のプロンプト")).resolves.toEqual({ blurred: "ぼかした文面" });
    expect(generateContent).toHaveBeenCalledTimes(3);

    // 再試行では元のプロンプトに失敗の理由を添えて投げ直す
    const sent = generateContent.mock.calls.map(([arg]) => arg.contents as string);
    expect(sent[0]).toBe("元のプロンプト");
    expect(sent[1]).toContain("元のプロンプト");
    expect(sent[1]).not.toBe(sent[0]);
  });

  it("JSON で返すよう指定して呼ぶ", async () => {
    generateContent.mockResolvedValue(reply('{"blurred": "文面"}'));
    const callStructured = await load();

    await callStructured(blurSchema, "p", { maxTokens: 800 });

    const [arg] = generateContent.mock.calls[0];
    expect(arg.model).toBe("gemini-3.1-flash-lite");
    expect(arg.config.responseMimeType).toBe("application/json");
    expect(arg.config.maxOutputTokens).toBe(800);
  });

  it("応答に text が無くても落ちずに再試行する", async () => {
    generateContent.mockResolvedValue({});
    const callStructured = await load();

    await expect(callStructured(blurSchema, "p")).rejects.toThrow(/構造化出力の取得に失敗/);
    expect(generateContent).toHaveBeenCalledTimes(3);
  });

  it("3回とも不正なら throw する", async () => {
    generateContent.mockResolvedValue(reply("not json"));
    const callStructured = await load();

    await expect(callStructured(blurSchema, "p")).rejects.toThrow(/構造化出力の取得に失敗/);
    expect(generateContent).toHaveBeenCalledTimes(3);
  });

  it("maxRetries を 0 にすると再試行しない", async () => {
    generateContent.mockResolvedValue(reply("not json"));
    const callStructured = await load();

    await expect(callStructured(blurSchema, "p", { maxRetries: 0 })).rejects.toThrow();
    expect(generateContent).toHaveBeenCalledTimes(1);
  });

  it("キーが無ければ SDK を呼ばずに throw する", async () => {
    vi.stubEnv("GEMINI_API_KEY", "");
    const callStructured = await load();

    await expect(callStructured(blurSchema, "p")).rejects.toThrow(/GEMINI_API_KEY/);
    expect(generateContent).not.toHaveBeenCalled();
  });
});
