import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { analyzeAction, cancelAction, escalateAction, sendAction } from "@/app/actions";
import type { Analysis } from "@/lib/ai/schemas";
import { userById } from "@/lib/data/users";
import Compose from "./Compose";

// 実物の actions は store を読み込むので、ファクトリで丸ごと差し替える
vi.mock("@/app/actions", () => ({
  analyzeAction: vi.fn(),
  blurAction: vi.fn(),
  cancelAction: vi.fn(),
  escalateAction: vi.fn(),
  sendAction: vi.fn(),
}));

const me = userById("u3")!;

const analysis = (over: Partial<Analysis> = {}): Analysis => ({
  actions: [{ description: "会議で発言を遮られた", observable: true }],
  context: "定例会議",
  targetHint: "山田 太郎",
  severity: 1,
  severityReason: "単発の言動",
  identifiability: "low",
  identifiabilityReason: "",
  organized: "会議で発言を遮られた。",
  ...over,
});

const LEVEL3 = analysis({ severity: 3, severityReason: "暴力に該当しうる", targetHint: null });

/** 本文を書いて「内容を確認する」を押すところまで */
async function writeAndAnalyze(body: string, result: Analysis) {
  vi.mocked(analyzeAction).mockResolvedValue({ ok: true, data: result });
  const user = userEvent.setup();
  render(<Compose me={me} />);
  await user.type(screen.getByRole("textbox", { name: "気になったこと" }), body);
  await user.click(screen.getByRole("button", { name: "内容を確認する" }));
  return user;
}

async function sendOnce() {
  vi.mocked(sendAction).mockResolvedValue({ ok: true, data: { id: "r-test" } });
  const user = await writeAndAnalyze("会議で山田さんに発言を遮られた", analysis());
  await user.click(await screen.findByRole("button", { name: "この内容を送る" }));
  await screen.findByText("受け付けました");
  return user;
}

beforeEach(() => {
  vi.resetAllMocks();
});

describe("送信後の完了画面", () => {
  it("送信に成功すると「受け付けました」と「取り消す」が出て、そのまま残る", async () => {
    await sendOnce();

    expect(sendAction).toHaveBeenCalledWith(expect.objectContaining({ authorId: "u3", targetId: "u1", severity: 1 }));
    expect(screen.getByRole("button", { name: "取り消す" })).toBeInTheDocument();

    // 完了画面が出たまま、書く画面に戻っていないこと
    expect(screen.getByText("受け付けました")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "取り消す" })).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "気になったこと" })).not.toBeInTheDocument();
  });

  it("取り消しに成功すると「取り消しました」になり、取り消しボタンが消える", async () => {
    vi.mocked(cancelAction).mockResolvedValue({ ok: true, data: null });
    const user = await sendOnce();

    await user.click(screen.getByRole("button", { name: "取り消す" }));

    expect(await screen.findByText("取り消しました")).toBeInTheDocument();
    expect(cancelAction).toHaveBeenCalledWith("u3", "r-test");
    expect(screen.queryByRole("button", { name: "取り消す" })).not.toBeInTheDocument();
  });

  it("取り消しに失敗するとエラーが出て、取り消せる案内とボタンが消える", async () => {
    vi.mocked(cancelAction).mockResolvedValue({ ok: false, error: "すでに配信されたため取り消せません。" });
    const user = await sendOnce();
    expect(screen.getByText("配信前であれば、この画面から取り消せます。")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "取り消す" }));

    expect(await screen.findByText("すでに配信されたため取り消せません。")).toBeInTheDocument();
    expect(screen.queryByText("配信前であれば、この画面から取り消せます。")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "取り消す" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "別の内容を書く" })).toBeInTheDocument();
  });
});

describe("レベル3", () => {
  it("「人事へ引き継ぐ」を押すと完了画面に切り替わり、書く画面には戻らない", async () => {
    vi.mocked(escalateAction).mockResolvedValue({ ok: true, data: null });
    const user = await writeAndAnalyze("上司に殴られた", LEVEL3);

    await user.click(await screen.findByRole("button", { name: "人事へ引き継ぐ" }));

    expect(await screen.findByText("人事担当に、あなたの名前とともに届きました。")).toBeInTheDocument();
    expect(escalateAction).toHaveBeenCalledTimes(1);
    expect(escalateAction).toHaveBeenCalledWith({
      authorId: "u3",
      rawBody: "上司に殴られた",
      severityReason: "暴力に該当しうる",
    });
    expect(sendAction).not.toHaveBeenCalled();
    // 二重に引き継げないよう、入力欄も確認ボタンも引き継ぎボタンも出さない
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "内容を確認する" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "人事へ引き継ぐ" })).not.toBeInTheDocument();
  });

  it("送信の操作は出さない", async () => {
    await writeAndAnalyze("上司に殴られた", LEVEL3);

    expect(await screen.findByText("このツールでは扱えません")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "この内容を送る" })).not.toBeInTheDocument();
  });

  it.each([
    ["本文に「伊藤」があり、対象者は読み取れない", "伊藤さんに殴られた", null],
    ["対象者は別人だが、本文に「伊藤」がある", "佐藤部長と伊藤さんに殴られた", "佐藤 健一"],
  ])("%s場合は、人事担当向けの注意を出し、引き継ぎボタンを出さない", async (_, body, targetHint) => {
    await writeAndAnalyze(body, { ...LEVEL3, targetHint });

    expect(await screen.findByText(/人事を経由した相談は、相手本人に届く/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "人事へ引き継ぐ" })).not.toBeInTheDocument();
  });
});
