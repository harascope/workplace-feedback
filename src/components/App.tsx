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

function Mark({ small = false }: { small?: boolean }) {
  return (
    <span className={`brand-mark ${small ? "brand-mark--small" : ""}`} aria-hidden>
      <svg viewBox="0 0 24 24" fill="none">
        <path d="M7 7.5h10M7 11.5h6.5M9.25 18l-4 2v-4.3A7 7 0 0 1 3 10.55C3 6.93 6.36 4 10.5 4h3C17.64 4 21 6.93 21 10.55s-3.36 6.55-7.5 6.55h-1.8" />
      </svg>
    </span>
  );
}

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
      <div className="shell demo-shell">
        <main className="demo-gate">
          <header className="demo-header">
            <div>
              <p className="demo-system-label">WORKPLACE FEEDBACK</p>
              <h1>デモ用選択画面</h1>
            </div>
            <span className="demo-version">v0.1 / DEMO</span>
          </header>

          <div className="demo-rule" />

          <section className="demo-selector" aria-label="表示モードを選択">
            <div className="demo-selector-head">
              <span>SELECT VIEW</span>
              <span>認証は実装されていません</span>
            </div>

            <button onClick={() => setMode("user")} className="demo-option">
              <span className="demo-option-index">01</span>
              <span className="demo-option-copy">
                <strong>利用者画面</strong>
                <small>フィードバックの作成・受信</small>
              </span>
              <span className="demo-option-arrow" aria-hidden>↗</span>
            </button>

            <button onClick={() => setMode("admin")} className="demo-option">
              <span className="demo-option-index">02</span>
              <span className="demo-option-copy">
                <strong>管理者画面</strong>
                <small>配信状況・部署別ステータス</small>
              </span>
              <span className="demo-option-arrow" aria-hidden>↗</span>
            </button>
          </section>

          <footer className="demo-meta">
            <span>LOCAL PROTOTYPE</span>
            <span>NO AUTHENTICATION</span>
          </footer>
        </main>
      </div>
    );
  }

  return (
    <div className="shell">
      <header className="topbar">
        <div className="app-header wrap-wide">
          <div className="brand-lockup brand-lockup--header">
            <Mark small />
            <span>Relay</span>
          </div>
          <div className="header-context">
            <span className="header-context-dot" />
            <p>
              {mode === "admin" ? "管理者として表示しています" : `${me.name} として表示しています`}
            </p>
          </div>

          <div className="header-actions">
            {mode === "user" && (
              <select
                className="field user-select"
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
            <button className="mode-switch" onClick={() => setMode(null)}>
              {mode === "admin" ? "利用者に戻る" : "管理者画面"}
            </button>
          </div>
        </div>
      </header>

      {mode === "user" && (
        <nav className="tabbar">
          <div className="wrap app-tabs">
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

      <main className="wrap app-main">
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

      <footer className="wrap app-footer">
        <hr className="rule" style={{ marginBottom: "1.1rem" }} />
        <button className="link-quiet" onClick={reset}>
          デモを初期状態に戻す
        </button>
      </footer>
    </div>
  );
}
