import { vi } from "vitest";

/**
 * テスト中に実ネットワーク（api コンテナや外部）へ出ないよう遮断する。
 * src/lib/api.ts を呼ぶテストは、api.ts 自体か fetch をモックすること。
 * 何もモックせずに api.ts が呼ばれたら、ここで throw して気づけるようにする。
 */
vi.stubGlobal(
  "fetch",
  vi.fn(() => {
    throw new Error("テスト中に実 fetch が呼ばれました。src/lib/api.ts かこの fetch をモックしてください");
  }),
);
