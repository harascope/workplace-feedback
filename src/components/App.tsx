"use client";

import { useCallback, useEffect, useState } from "react";
import { inboxAction, resetAction, stubModeAction } from "@/app/actions";
import { USERS, userById } from "@/lib/data/users";
import Admin from "./Admin";
import Compose from "./Compose";
import Inbox from "./Inbox";

/**
 * 入口は「利用者」と「管理者」の2つだけ。
 *
 * 送信者／受信者を分けない理由（仕様書 0.4）:
 * 入口で立場を選ばせると、開くこと自体が意思表示になる。
 * 「私はこれから告発します」という構えを要求することになり、
 * 小規模組織では利用の事実そのものが推測材料になる。
 * 全員が同じ画面を使い、書くことも受け取ることも同じ場所で行う。
 */
type Mode = "user" | "admin";

type Tab = "write" | "inbox";

export default function App() {
  // 認証は実装しない。人物セレクタで代用する。
  const [mode, setMode] = useState<Mode | null>(null);
  const [tab, setTab] = useState<Tab>("write");
  const [meId, setMeId] = useState("u3");
  const [nonce, setNonce] = useState(0);
  const [stub, setStub] = useState(false);
  const [inboxCount, setInboxCount] = useState(0);

  const me = userById(meId)!;

  useEffect(() => {
    void stubModeAction().then(setStub);
  }, []);

  const refreshInbox = useCallback(async () => {
    const r = await inboxAction(meId);
    if (r.ok) setInboxCount(r.data.length);
  }, [meId]);

  useEffect(() => {
    if (mode === "user") void refreshInbox();
  }, [mode, refreshInbox, nonce]);

  const reset = async () => {
    await resetAction();
    setNonce((n) => n + 1);
  };

  const bump = () => setNonce((n) => n + 1);

  if (!mode) {
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
            <button onClick={() => setMode("user")} className="card-choice">
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
                    利用
                  </span>
                  <span>
                    <span style={{ fontSize: "0.98rem", fontWeight: 700 }}>利用者として使う</span>
                    <span className="lede" style={{ display: "block", fontSize: "0.83rem" }}>
                      書くことも、届いたものを読むことも、同じ画面でできます
                    </span>
                  </span>
                </span>
                <span aria-hidden style={{ color: "var(--brand)", fontSize: "1.1rem", lineHeight: 1 }}>
                  →
                </span>
              </span>
            </button>

            <button onClick={() => setMode("admin")} className="card-choice">
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
                    管理
                  </span>
                  <span>
                    <span style={{ fontSize: "0.98rem", fontWeight: 700 }}>管理者として見る</span>
                    <span className="lede" style={{ display: "block", fontSize: "0.83rem" }}>
                      配信状況と、部署ごとの状態を見る
                    </span>
                  </span>
                </span>
                <span aria-hidden style={{ color: "var(--brand)", fontSize: "1.1rem", lineHeight: 1 }}>
                  →
                </span>
              </span>
            </button>
          </div>

          <p className="fineprint" style={{ marginTop: "2.5rem" }}>
            デモのため認証はありません。本番では社内アカウントで認証し、利用者はこの選択なしに自分の画面へ入ります。
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
            <p className="eyebrow">
              {mode === "admin" ? "管理者として表示しています" : `${me.name} として表示しています`}
            </p>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: "0.85rem" }}>
            {mode === "user" && (
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
            <button className="link-quiet" onClick={() => setMode(null)}>
              {mode === "admin" ? "利用者に戻る" : "管理者画面へ"}
            </button>
          </div>
        </div>
      </header>

      {mode === "user" && (
        <nav className="tabbar">
          <div className="wrap" style={{ display: "flex", gap: "0.25rem" }}>
            <button
              className={`tab ${tab === "write" ? "tab--on" : ""}`}
              onClick={() => setTab("write")}
            >
              書く
            </button>
            <button
              className={`tab ${tab === "inbox" ? "tab--on" : ""}`}
              onClick={() => {
                setTab("inbox");
                void refreshInbox();
              }}
            >
              届いたもの
              {inboxCount > 0 && <span className="tab-count">{inboxCount}</span>}
            </button>
          </div>
        </nav>
      )}

      <main className="wrap" style={{ paddingBlock: "2.25rem 1rem", flex: 1 }}>
        {stub && (
          <div className="notice notice--warn" style={{ marginBottom: "1.75rem" }}>
            <div className="fineprint" style={{ color: "var(--warn)" }}>
              スタブ動作中。ANTHROPIC_API_KEY が未設定のため、AI 呼び出しは簡易な代替処理に置き換わっています。
              画面の分岐は確認できますが、文面の質は実際のものではありません。
            </div>
          </div>
        )}

        {mode === "user" && tab === "write" && (
          <Compose me={me} key={`w${meId}${nonce}`} onSent={bump} />
        )}
        {mode === "user" && tab === "inbox" && (
          <Inbox me={me} key={`i${meId}${nonce}`} onChanged={refreshInbox} />
        )}
        {mode === "admin" && <Admin key={`a${nonce}`} onChanged={bump} />}
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
