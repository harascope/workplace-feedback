import { vi } from "vitest";

/**
 * テスト中に実 API（api.anthropic.com）へ出ないよう、二重に遮断する。
 * 1. キーを空にして、AI の呼び出しをスタブに倒す
 * 2. それでも SDK に届いたら throw する
 * client.ts のテストだけは、ファイル内の vi.mock で SDK を上書きする。
 */
vi.stubEnv("ANTHROPIC_API_KEY", "");

vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    constructor() {
      throw new Error("テスト中に実 API の SDK が呼ばれました。ANTHROPIC_API_KEY を空にするか、SDK をモックしてください");
    }
  },
}));
