import { vi } from "vitest";

/**
 * テスト中に実 API（generativelanguage.googleapis.com）へ出ないよう、二重に遮断する。
 * 1. キーを空にして、AI の呼び出しをスタブに倒す
 * 2. それでも SDK に届いたら throw する
 * client.ts のテストだけは、ファイル内の vi.mock で SDK を上書きする。
 */
vi.stubEnv("GEMINI_API_KEY", "");

vi.mock("@google/genai", () => ({
  GoogleGenAI: class {
    constructor() {
      throw new Error("テスト中に実 API の SDK が呼ばれました。GEMINI_API_KEY を空にするか、SDK をモックしてください");
    }
  },
}));
