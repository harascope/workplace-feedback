"use client";

import { useEffect, useRef, useState } from "react";
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
 * 人物セレクタは横に並ぶ小さなボタンにする。名簿6人を縦積みの大カードにすると
 * それだけで画面が埋まり、選んだ人の中身が折り返しの下に押し出されて
 * 「押しても何も変わらない」ように見えるため（実利用で出た指摘）。
 * 切り替わったことは3つで伝える: 表示中の人物を主色で塗る／中身の直前に
 * 「〇〇 に届いたもの」の見出しを出す／選んだ直後に中身の先頭へスクロールする。
 *
 * デモで「誰に何件届いているか」が一目で伝わるよう、各ボタンに件数を出す。
 * 件数は既存の inboxAction(userId) を6人ぶん呼んで集める（新しい Server Action は増やさない）。
 * 応答内容（誰が送ったか）はここでは扱わない。
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
  // 人物を「押して」切り替えたときだけスクロールする。初回表示では動かさない。
  const [wantScroll, setWantScroll] = useState(false);
  const headRef = useRef<HTMLHeadingElement>(null);

  const load = async () => {
    const r = await inboxAction(me.id);
    if (r.ok) setItems(r.data);
  };

  useEffect(() => {
    // 前の人物の中身を残したまま見出しだけ差し替わると、別人の受け取りboxを
    // その人のものとして見せてしまう。読み込み中の表示に戻してから取り直す。
    setItems(null);
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

  // 中身が入れ替わってから動かす。読み込み中は本文が短く、狙った位置まで動けない。
  useEffect(() => {
    if (!wantScroll || items === null) return;
    setWantScroll(false);
    const el = headRef.current;
    if (!el) return;
    // すでに視界の上寄りにあるなら中身は見えている。用も無く画面を動かさない
    const top = el.getBoundingClientRect().top;
    if (top >= 0 && top < window.innerHeight * 0.5) return;
    const still = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    el.scrollIntoView({ behavior: still ? "auto" : "smooth", block: "start" });
  }, [wantScroll, items]);

  const pick = (id: string) => {
    setWantScroll(true);
    onChangeMe(id);
  };

  const respond = async (id: string, kind: "ack" | "dispute") => {
    await respondAction(id, kind);
    onChanged?.();
    void load();
  };

  const viewer = (
    <div style={{ marginBottom: "1.5rem" }}>
      <span className="label">誰として見るか</span>
      <div className="person-picks" style={{ marginTop: "0.45rem" }}>
        {users.map((u) => {
          const on = u.id === me.id;
          return (
            <button
              key={u.id}
              type="button"
              className={`person-pick ${on ? "person-pick--on" : ""}`}
              aria-label={`${u.name}（${u.title}）`}
              aria-pressed={on}
              onClick={() => pick(u.id)}
            >
              <span className="person-pick__who">
                {on && (
                  <span className="person-pick__mark" aria-hidden>
                    ✓
                  </span>
                )}
                <span className="person-pick__name">{u.name}</span>
                <span className="person-pick__sub">（{u.title}）</span>
              </span>
              <span className="tab-count" aria-hidden>
                {counts ? counts[u.id] : "…"}
              </span>
            </button>
          );
        })}
      </div>
      <p className="fineprint" style={{ marginTop: "0.5rem" }}>
        数字は届いた件数だけで、誰が送ったかは分かりません。押した人物は「送る」タブの送信者にもなります。
      </p>
    </div>
  );

  // 上の帯の「〇〇 として表示しています」は中身から遠い。中身の直前でも誰のものか言う
  const head = (
    <h2 className="inbox-head" ref={headRef}>
      <span>
        {me.name}（{me.title}）に届いたもの
      </span>
      {items !== null && <span className="badge">{items.length}件</span>}
    </h2>
  );

  if (items === null) {
    return (
      <div>
        {viewer}
        {head}
        <p className="fineprint">読み込んでいます…</p>
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div>
        {viewer}
        {head}
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
      {head}

      <p className="lede" style={{ marginBottom: "1.5rem", maxWidth: "36rem" }}>
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
