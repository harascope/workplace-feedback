import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { adminAction, deliverAction, type AdminView } from "@/app/actions";
import Admin from "./Admin";

vi.mock("@/app/actions", () => ({
  adminAction: vi.fn(),
  deliverAction: vi.fn(),
}));

const view = (over: Partial<AdminView> = {}): AdminView => ({
  pending: 0,
  depts: [
    { dept: "営業部", level: 3, label: "レベル 3", detail: "重大度2以上が 1/1" },
    { dept: "開発部", level: null, label: "データなし", detail: "申告がありません" },
  ],
  escalations: [],
  ...over,
});

beforeEach(() => {
  vi.resetAllMocks();
});

describe("Admin", () => {
  it("引き継ぎが0件なら「ありません」、集計の対象の補足も出る", async () => {
    vi.mocked(adminAction).mockResolvedValue({ ok: true, data: view() });
    render(<Admin />);

    expect(await screen.findByText("ありません")).toBeInTheDocument();
    expect(screen.getByText(/集計するのは配信済みの申告だけです/)).toBeInTheDocument();
    expect(screen.getByText("データなし")).toBeInTheDocument();
    expect(screen.getByText("レベル 3")).toBeInTheDocument();
  });

  it("引き継ぎがあれば、氏名と本人が書いた内容を出す", async () => {
    vi.mocked(adminAction).mockResolvedValue({
      ok: true,
      data: view({
        escalations: [
          { id: "e1", authorName: "鈴木 花子", rawBody: "上司に殴られた", severityReason: "暴力", createdAt: Date.now() },
        ],
      }),
    });
    render(<Admin />);

    expect(await screen.findByText("鈴木 花子")).toBeInTheDocument();
    expect(screen.getByText("上司に殴られた")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /人事への引き継ぎ（1 件）/ })).toBeInTheDocument();
    expect(screen.queryByText("ありません")).not.toBeInTheDocument();
  });

  it("未配信が0件なら配信ボタンは押せない", async () => {
    vi.mocked(adminAction).mockResolvedValue({ ok: true, data: view({ pending: 0 }) });
    render(<Admin />);

    expect(await screen.findByRole("button", { name: "いま配信する" })).toBeDisabled();
  });

  it("配信すると表示を更新し、親に知らせる", async () => {
    vi.mocked(adminAction).mockResolvedValue({ ok: true, data: view({ pending: 2 }) });
    vi.mocked(deliverAction).mockResolvedValue({ ok: true, data: view({ pending: 0 }) });
    const onChanged = vi.fn();
    const user = userEvent.setup();
    render(<Admin onChanged={onChanged} />);

    const button = await screen.findByRole("button", { name: "いま配信する" });
    expect(button).toBeEnabled();
    await user.click(button);

    expect(await screen.findByRole("button", { name: "いま配信する" })).toBeDisabled();
    expect(deliverAction).toHaveBeenCalledTimes(1);
    expect(onChanged).toHaveBeenCalledTimes(1);
  });
});
