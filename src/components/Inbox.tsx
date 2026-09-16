"use client";

import { useEffect, useState } from "react";
import { inboxAction, respondAction } from "@/app/actions";
import type { User } from "@/lib/data/users";
import type { InboxItem } from "@/lib/api";
import { Btn, Field, Notice } from "./ui";

/**
 * 受信画面。扱うのは InboxItem のみで、送信者に関する情報はこの層に存在しない。
 *
 * 「誰として見るか」の切り替えもここに置く（トップバーには置かない。トップバーは
 * 地の色が濃く、白背景を前提にした .field の文字色と衝突するため）。
 * ここで選んだ人物は、受け取りboxの表示だけでなく「送る」タブの送信者にもなる（meId を共有）。
 *
 * デモで「誰に何件届いているか」が一目で伝わるよう、名簿6人を並べたカードにして
 * それぞれの件数を出す。件数は既存の inboxAction(userId) を6人ぶん呼んで集める
 * （新しい Server Action は増やさない）。応答内容（誰が送ったか）はここでは扱わない。
 */
export default function Inbox({
  me,
  users,
  onChangeMe,
  onChanged,
}: {
  me: User;
  users: User[];
  onChangeMe: (id: string) => void;
  onChanged?: () => void;
}) {
  const [items, setItems] = useState<InboxItem[] | null>(null);
  // 人物ごとの届いている件数。null は「まだ読み込み中」。人物ごとに出し分けると
  // 6回の呼び出しの間で数字がバラバラに現れてちらつくので、まとめて1回で反映する。
  const [counts, setCounts] = useState<Record<string, number> | null>(null);

  const load = async () => {
    const r = await inboxAction(me.id);
    if (r.ok) setItems(r.data);
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me.id]);

  useEffect(() => {
    let cancelled = false;
    void Promise.all(users.map((u) => inboxAction(u.id))).then((results) => {
      if (cancelled) return;
      const next: Record<string, number> = {};
      results.forEach((r, i) => {
        next[users[i].id] = r.ok ? r.data.length : 0;
      });
      setCounts(next);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const respond = async (id: string, kind: "ack" | "dispute") => {
    await respondAction(id, kind);
    onChanged?.();
    void load();
  };

  const viewer = (
    <div style={{ marginBottom: "1.75rem" }}>
      <span className="label">誰として見るか</span>
      <div style={{ display: "grid", gap: "0.6rem", marginTop: "0.5rem" }}>
        {users.map((u) => {
          const on = u.id === me.id;
          return (
            <button
              key={u.id}
              type="button"
              className={`card-choice ${on ? "card-choice--on" : ""}`}
              aria-label={`${u.name}（${u.title}）`}
              aria-pressed={on}
              onClick={() => onChangeMe(u.id)}
            >
              <span style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "1rem" }}>
                <span>
                  <span style={{ fontSize: "0.92rem", fontWeight: 700 }}>{u.name}</span>
                  <span className="fineprint" style={{ display: "block" }}>
                    {u.title}
                  </span>
                </span>
                <span className="tab-count" aria-hidden>
                  {counts ? counts[u.id] : "…"}
                </span>
              </span>
            </button>
          );
        })}
      </div>
      <p className="fineprint" style={{ marginTop: "0.75rem" }}>
        押した人物の受け取りboxが表示されます。「送る」タブの送信者も同じ人物になります。件数はその人に届いた件数のみで、誰が送ったかは分かりません。
      </p>
    </div>
  );

  if (items === null) {
    return (
      <div>
        {viewer}
        <p className="fineprint">読み込んでいます…</p>
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div>
        {viewer}
        <Notice tone="quiet" title="今回は届いていません">
          フィードバックは毎週月曜にまとめて届きます。届いていない週も、この画面でお知らせします。
        </Notice>
        <p className="fineprint" style={{ marginTop: "1.1rem", maxWidth: "34rem" }}>
          全員に毎週配信されます。届いた週だけ通知が来る仕組みにすると、受け取ったこと自体が周囲に伝わってしまうためです。
        </p>
      </div>
    );
  }

  return (
    <div>
      {viewer}

      <p className="lede" style={{ marginBottom: "1.75rem", maxWidth: "36rem" }}>
        今週のフィードバックです。誰が書いたかは分かりません。事実として確定したものではなく、そう受け止めた人がいる、という記録です。
      </p>

      <div style={{ display: "grid", gap: "1.25rem" }}>
        {items.map((r) => (
          <article key={r.id} className="card" style={{ padding: "1.5rem 1.625rem" }}>
            <div style={{ display: "grid", gap: "1.25rem" }}>
              <Field label="指摘されている内容">{r.composed ? r.composed.what : r.body}</Field>

              {r.composed && (
                <>
                  <Field label="なぜ問題になりうるか">{r.composed.why}</Field>
                  <Field label="一般的な対応">{r.composed.how}</Field>
                </>
              )}
            </div>

            {!r.hasContext && (
              <p className="fineprint" style={{ marginTop: "1.1rem" }}>
                特定の場面は示されていません。普段の言動として受け止めてください。
              </p>
            )}

            <div style={{ marginTop: "1.5rem", paddingTop: "1.125rem", borderTop: "1px solid var(--line)" }}>
              {r.response ? (
                <p className="fineprint">
                  {r.response === "ack"
                    ? "「理解した」と回答済み"
                    : "「認識が違う」と回答済み。記録されていますが、相手には自動では届きません。"}
                </p>
              ) : (
                <div style={{ display: "flex", flexWrap: "wrap", gap: "0.6rem" }}>
                  <Btn variant="ghost" onClick={() => respond(r.id, "ack")}>
                    理解した
                  </Btn>
                  <Btn variant="ghost" onClick={() => respond(r.id, "dispute")}>
                    認識が違う
                  </Btn>
                </div>
              )}
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
