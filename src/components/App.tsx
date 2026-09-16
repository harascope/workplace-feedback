"use client";

import { useCallback, useEffect, useState } from "react";
import { inboxAction, resetAction, stubModeAction } from "@/app/actions";
import { USERS, userById } from "@/lib/data/users";
import Admin from "./Admin";
import Compose from "./Compose";
import Inbox from "./Inbox";

/**
 * 画面は「送る」「受け取りbox」「管理者」の3タブだけ。入口の選択画面は無い。
 *
 * 送信者／受信者を分けない理由（仕様書 0.4）:
 * 入口で立場を選ばせると、開くこと自体が意思表示になる。
 * 「私はこれから告発します」という構えを要求することになり、
 * 小規模組織では利用の事実そのものが推測材料になる。
 * 3タブは送信者・受信者の二択ではなく操作の切り替えであり、
 * 全員が同じ画面から、書くことも受け取ることも見ることもできる。
 *
 * 人物セレクタは「受け取りbox」タブの中にある（Inbox.tsx）。
 * 選んだ人物は受け取りboxの表示だけでなく、「送る」タブの送信者にも使われる（meId を共有）。
 */
type Tab = "compose" | "inbox" | "admin";

export default function App() {
  // 認証は実装しない。人物セレクタで代用する。
  const [tab, setTab] = useState<Tab>("compose");
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
    void refreshInbox();
  }, [refreshInbox, nonce]);

  const reset = async () => {
    await resetAction();
    setNonce((n) => n + 1);
  };

  const bump = () => setNonce((n) => n + 1);

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
            <p className="eyebrow">{me.name} として表示しています</p>
          </div>
        </div>
      </header>

      <nav className="tabbar">
        <div className="wrap" style={{ display: "flex", gap: "0.25rem" }}>
          <button
            className={`tab ${tab === "compose" ? "tab--on" : ""}`}
            onClick={() => setTab("compose")}
          >
            送る
          </button>
          <button
            className={`tab ${tab === "inbox" ? "tab--on" : ""}`}
            onClick={() => {
              setTab("inbox");
              void refreshInbox();
            }}
          >
            受け取りbox
            {inboxCount > 0 && <span className="tab-count">{inboxCount}</span>}
          </button>
          <button
            className={`tab ${tab === "admin" ? "tab--on" : ""}`}
            onClick={() => setTab("admin")}
          >
            管理者
          </button>
        </div>
      </nav>

      <main className="wrap" style={{ paddingBlock: "2.25rem 1rem", flex: 1 }}>
        {stub && (
          <div className="notice notice--warn" style={{ marginBottom: "1.75rem" }}>
            <div className="fineprint" style={{ color: "var(--warn)" }}>
              スタブ動作中。GEMINI_API_KEY が未設定のため、AI 呼び出しは簡易な代替処理に置き換わっています。
              画面の分岐は確認できますが、文面の質は実際のものではありません。
            </div>
          </div>
        )}

        {tab === "compose" && <Compose me={me} key={`w${meId}${nonce}`} />}
        {tab === "inbox" && (
          <Inbox
            me={me}
            users={USERS}
            onChangeMe={setMeId}
            onChanged={refreshInbox}
            key={`i${nonce}`}
          />
        )}
        {tab === "admin" && <Admin key={`a${nonce}`} onChanged={bump} />}
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
