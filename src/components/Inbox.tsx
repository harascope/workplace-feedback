"use client";

import { useEffect, useState } from "react";
import { inboxAction, respondAction } from "@/app/actions";
import type { User } from "@/lib/data/users";
import type { InboxItem } from "@/lib/store";
import { Btn, Field, Notice } from "./ui";

/**
 * 受信画面。扱うのは InboxItem のみで、送信者に関する情報はこの層に存在しない。
 */
export default function Inbox({ me }: { me: User }) {
  const [items, setItems] = useState<InboxItem[] | null>(null);

  const load = async () => {
    const r = await inboxAction(me.id);
    if (r.ok) setItems(r.data);
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me.id]);

  const respond = async (id: string, kind: "ack" | "dispute") => {
    await respondAction(id, kind);
    void load();
  };

  if (items === null) {
    return <p className="fineprint">読み込んでいます…</p>;
  }

  if (items.length === 0) {
    return (
      <div>
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
