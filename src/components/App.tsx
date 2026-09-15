"use client";

import { useEffect, useState } from "react";
import { resetAction, stubModeAction } from "@/app/actions";
import { USERS, userById } from "@/lib/data/users";
import Admin from "./Admin";
import Compose from "./Compose";
import Inbox from "./Inbox";

type Role = "sender" | "recipient" | "admin";

const ROLES: { key: Role; label: string; note: string; mark: string }[] = [
  { key: "sender", label: "送信者", note: "気になったことを書いて、相手に届ける", mark: "送" },
  { key: "recipient", label: "受信者", note: "自分に届いたフィードバックを読む", mark: "受" },
  { key: "admin", label: "管理者", note: "配信状況と、部署ごとの状態を見る", mark: "管" },
];

export default function App() {
  // 認証は実装しない。ロール選択と人物セレクタで代用する。
  const [role, setRole] = useState<Role | null>(null);
  const [meId, setMeId] = useState("u3");
  const [nonce, setNonce] = useState(0);
  const [stub, setStub] = useState(false);

  const me = userById(meId)!;

  useEffect(() => {
    void stubModeAction().then(setStub);
  }, []);

  const reset = async () => {
    await resetAction();
    setNonce((n) => n + 1);
  };

  if (!role) {
    return (
      <div className="shell">
        <div className="wrap" style={{ paddingBlock: "5rem 3rem" }}>
          <h1 className="title">言いにくいことを、届ける</h1>
          <p className="eyebrow" style={{ marginTop: "0.4rem" }}>
            社内フィードバック（デモ）
          </p>

          <p className="lede" style={{ marginTop: "2.5rem", maxWidth: "34rem" }}>
            職場で気になったことを、相手に匿名で伝えるためのツールです。
            誰が書いたかは、相手にも人事にも表示されません。
          </p>

          <div style={{ marginTop: "2.5rem", display: "grid", gap: "0.75rem" }}>
            {ROLES.map((r) => (
              <button key={r.key} onClick={() => setRole(r.key)} className="card-choice">
                <span
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: "1rem",
                  }}
                >
                  <span style={{ display: "flex", alignItems: "center", gap: "0.9rem" }}>
                    <span className="chip" aria-hidden>
                      {r.mark}
                    </span>
                    <span>
                      <span style={{ fontSize: "0.98rem", fontWeight: 700 }}>{r.label}</span>
                      <span className="lede" style={{ display: "block", fontSize: "0.83rem" }}>
                        {r.note}
                      </span>
                    </span>
                  </span>
                  <span aria-hidden style={{ color: "var(--brand)", fontSize: "1.1rem", lineHeight: 1 }}>
                    →
                  </span>
                </span>
              </button>
            ))}
          </div>

          <p className="fineprint" style={{ marginTop: "2.5rem" }}>
            デモのため認証はありません。本番では社内アカウントで認証します。
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="shell">
      <header className="topbar">
        <div
          className="wrap"
          style={{
            paddingBlock: "1.15rem",
            display: "flex",
            flexWrap: "wrap",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "0.9rem",
          }}
        >
          <div>
            <h1 className="title" style={{ fontSize: "1.05rem" }}>
              言いにくいことを、届ける
            </h1>
            <p className="eyebrow">{ROLES.find((r) => r.key === role)!.label}として表示しています</p>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: "0.85rem" }}>
            {role !== "admin" && (
              <select
                className="field"
                style={{ width: "auto" }}
                aria-label="表示する人物"
                value={meId}
                onChange={(e) => setMeId(e.target.value)}
              >
                {USERS.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}（{u.title}）
                  </option>
                ))}
              </select>
            )}
            <button className="link-quiet" onClick={() => setRole(null)}>
              立場を変える
            </button>
          </div>
        </div>
      </header>

      <main className="wrap" style={{ paddingBlock: "2.25rem 1rem", flex: 1 }}>
        {stub && (
          <div className="notice notice--warn" style={{ marginBottom: "1.75rem" }}>
            <div className="fineprint" style={{ color: "var(--warn)" }}>
              スタブ動作中。ANTHROPIC_API_KEY が未設定のため、AI 呼び出しは簡易な代替処理に置き換わっています。
              画面の分岐は確認できますが、文面の質は実際のものではありません。
            </div>
          </div>
        )}

        {role === "sender" && <Compose me={me} key={`s${meId}${nonce}`} />}
        {role === "recipient" && <Inbox me={me} key={`r${meId}${nonce}`} />}
        {role === "admin" && <Admin key={`a${nonce}`} onChanged={() => setNonce((n) => n + 1)} />}
      </main>

      <footer className="wrap" style={{ paddingBlock: "1.5rem 2.5rem" }}>
        <hr className="rule" style={{ marginBottom: "1.1rem" }} />
        <button className="link-quiet" onClick={reset}>
          デモを初期状態に戻す
        </button>
      </footer>
    </div>
  );
}
