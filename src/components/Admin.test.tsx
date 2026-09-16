import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { adminAction, deliverAction, seedDemoAction, type AdminView } from "@/app/actions";
import Admin from "./Admin";

vi.mock("@/app/actions", () => ({
  adminAction: vi.fn(),
  deliverAction: vi.fn(),
  seedDemoAction: vi.fn(),
}));

const dept = (over: Partial<AdminView["depts"][number]> = {}): AdminView["depts"][number] => ({
  dept: "営業部",
  level: 3,
  label: "5 段階中 3",
  detail: "重大度2以上が 1/1",
  memberCount: 3,
  belowMinMembers: false,
  alert: false,
  ...over,
});

const view = (over: Partial<AdminView> = {}): AdminView => ({
  pending: 0,
  depts: [
    dept(),
    dept({ dept: "開発部", level: null, label: "データなし", detail: "申告がありません", memberCount: 1, belowMinMembers: true }),
  ],
  escalations: [],
  severityMix: { level1: 2, level2: 1 },
  delivery: {
    nextAt: Date.parse("2026-09-21T00:00:00Z"),
    intervalDays: 7,
    oldestPendingDays: null,
    deliveredTotal: 3,
  },
  levelMax: 5,
  deptAlertMinMembers: 3,
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
  });

  it("部署評価は「5 段階中 N」で出し、申告の重大度レベルと取り違えさせない", async () => {
    vi.mocked(adminAction).mockResolvedValue({ ok: true, data: view() });
    render(<Admin />);

    const level = await screen.findByLabelText("5 段階中 3（5 が最も危険）");
    expect(level).toHaveTextContent("5 段階中");
    expect(level).toHaveTextContent("3");
    // 「レベル 3」は送信画面の重大度（このツールでは扱えない事案）を指す語。部署評価では使わない
    expect(screen.queryByText("レベル 3")).not.toBeInTheDocument();
    expect(screen.getByText(/申告の重大度レベル（上の内訳）とは別の指標です/)).toBeInTheDocument();
  });

  it("配信ボタンを押す前に、何件届き取り消せなくなることを書く", async () => {
    vi.mocked(adminAction).mockResolvedValue({ ok: true, data: view({ pending: 2 }) });
    render(<Admin />);

    expect(await screen.findByText(/押すと未配信の 2 件がまとめて届きます/)).toBeInTheDocument();
    expect(
      screen.getByText(/送信者が自分で取り消すことはできなくなります/),
    ).toBeInTheDocument();
  });

  it("配信済みの重大度の内訳を出す", async () => {
    vi.mocked(adminAction).mockResolvedValue({ ok: true, data: view() });
    render(<Admin />);

    expect(await screen.findByText("レベル1（単発の言動など）")).toBeInTheDocument();
    expect(screen.getByText("レベル2（継続的な言動など）")).toBeInTheDocument();
    // 部署 × 重大度の表は出さない。件数は全社の合計だけ
    expect(screen.getByText(/部署ごとに件数を割ると/)).toBeInTheDocument();
  });

  it("母数が足りない部署は「部署単位では判断しない」と示す", async () => {
    vi.mocked(adminAction).mockResolvedValue({ ok: true, data: view() });
    render(<Admin />);

    expect(await screen.findByText("在籍 1 人 ・ 部署単位では判断しない")).toBeInTheDocument();
  });

  it("部署アラートは件数を出さず、一段上へ上げると書く", async () => {
    vi.mocked(adminAction).mockResolvedValue({
      ok: true,
      data: view({ depts: [dept({ alert: true, level: 4, label: "5 段階中 4" })] }),
    });
    render(<Admin />);

    expect(await screen.findByText(/営業部で、複数の申告が集まっています/)).toBeInTheDocument();
    expect(screen.getByText(/その部署の管理者を飛ばして一段上へ送ります/)).toBeInTheDocument();
    // 見出しと、その部署のカードに付く印の2か所
    expect(screen.getAllByText("部署アラート")).toHaveLength(2);
    // 件数は出さない（仕様書 6.2「件数非表示」）
    expect(screen.queryByText(/\d+ ?件の申告/)).not.toBeInTheDocument();
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

  it("未配信が0件なら配信ボタンは押せず、届く件数の注意も出さない", async () => {
    vi.mocked(adminAction).mockResolvedValue({ ok: true, data: view({ pending: 0 }) });
    render(<Admin />);

    expect(await screen.findByRole("button", { name: "いま配信する" })).toBeDisabled();
    expect(screen.queryByText(/押すと未配信の/)).not.toBeInTheDocument();
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

  it("デモ用データを入れると表示を更新し、親に知らせる", async () => {
    vi.mocked(adminAction).mockResolvedValue({ ok: true, data: view({ pending: 0 }) });
    vi.mocked(seedDemoAction).mockResolvedValue({ ok: true, data: view({ pending: 8 }) });
    const onChanged = vi.fn();
    const user = userEvent.setup();
    render(<Admin onChanged={onChanged} />);

    await user.click(await screen.findByRole("button", { name: "デモ用データを入れる" }));

    expect(seedDemoAction).toHaveBeenCalledTimes(1);
    expect(onChanged).toHaveBeenCalledTimes(1);
    expect(await screen.findByRole("button", { name: "いま配信する" })).toBeEnabled();
  });

  it("データが空でも画面として成立し、入れ方を案内する", async () => {
    vi.mocked(adminAction).mockResolvedValue({
      ok: true,
      data: view({
        pending: 0,
        severityMix: { level1: 0, level2: 0 },
        delivery: { nextAt: Date.parse("2026-09-21T00:00:00Z"), intervalDays: 7, oldestPendingDays: null, deliveredTotal: 0 },
      }),
    });
    render(<Admin />);

    expect(await screen.findByText("まだ申告がありません")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "デモ用データを入れる" })).toBeEnabled();
  });
});
