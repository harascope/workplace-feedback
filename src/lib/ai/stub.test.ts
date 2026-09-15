import { afterEach, describe, expect, it, vi } from "vitest";
import { analyze } from "./analyze";
import { blur } from "./blur";
import { compose } from "./compose";
import { analysisSchema, composedSchema } from "./schemas";
import { isStubMode, stubAnalyze, stubBlur } from "./stub";

const NAMES = ["山田 太郎", "佐藤 健一", "伊藤 彩"];

afterEach(() => {
  // setup で空にしたキーへ戻す
  vi.stubEnv("ANTHROPIC_API_KEY", "");
});

describe("isStubMode", () => {
  it("キーが空ならスタブ、入っていれば実 API", () => {
    expect(isStubMode()).toBe(true);
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-test");
    expect(isStubMode()).toBe(false);
  });
});

describe("キーが無いときの analyze / blur / compose", () => {
  it("analyze はスタブで動き、スキーマを通る", async () => {
    const a = await analyze({ body: "先週の定例で佐藤部長に発言を遮られた。", candidateNames: NAMES });

    expect(() => analysisSchema.parse(a)).not.toThrow();
    expect(a.targetHint).toBe("佐藤 健一");
  });

  it("blur はスタブで動き、文字列を返す", async () => {
    await expect(blur("1on1で言われた")).resolves.toEqual(expect.any(String));
  });

  it("compose はスタブで動き、スキーマを通る", async () => {
    const c = await compose("会議で遮られた");
    expect(() => composedSchema.parse(c)).not.toThrow();
  });

  it("キーを入れても SDK はモックなので、外へは出ずに失敗する", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-test");
    await expect(compose("会議で遮られた")).rejects.toThrow(/実 API/);
  });
});

describe("stubAnalyze の判定", () => {
  it.each(["上司に殴られた", "脅された", "死にたい"])("レベル3のキーワード（%s）で severity は 3", (body) => {
    expect(stubAnalyze(body, NAMES).severity).toBe(3);
  });

  it("継続性のある記述は 2、単発は 1", () => {
    expect(stubAnalyze("毎回会議で怒鳴られる", NAMES).severity).toBe(2);
    expect(stubAnalyze("会議で一度遮られた", NAMES).severity).toBe(1);
  });

  it.each(["昨日の1on1で言われた", "二人きりのときに言われた", "3/14に言われた"])(
    "特定されやすい書き方（%s）で identifiability は high",
    (body) => {
      expect(stubAnalyze(body, NAMES).identifiability).toBe("high");
    },
  );

  it("特定につながる手がかりが無ければ low", () => {
    expect(stubAnalyze("会議で遮られた", NAMES).identifiability).toBe("low");
  });

  it("ぼかした文面は high にならない", () => {
    const blurred = stubBlur("3/14の1on1で、二人きりのときに私だけ言われた");

    expect(blurred).not.toMatch(/1on1|二人|3\/14|私だけ/);
    expect(stubAnalyze(blurred, NAMES).identifiability).toBe("low");
  });
});
