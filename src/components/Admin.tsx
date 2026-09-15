"use client";

import { useEffect, useState } from "react";
import { adminAction, deliverAction, type AdminView } from "@/app/actions";
import { Btn, Field } from "./ui";

/**
 * 5 段階の目盛り。申告ゼロの部署には表示しない。
 * 空の目盛りを出すと「レベル0＝安全」に見え、「データなし」と区別がつかなくなるため。
 */
function Meter({ level }: { level: number }) {
  return (
    <div style={{ display: "flex", gap: 3 }} aria-hidden>
      {[1, 2, 3, 4, 5].map((i) => {
        const on = i <= level;
        const hue =
          level >= 4 ? "var(--stop)" : level >= 3 ? "var(--copper)" : "var(--brand)";
        return (
          <span
            key={i}
            style={{
              width: 20,
              height: 7,
              borderRadius: 3,
              background: on ? hue : "var(--line)",
              boxShadow: on
                ? "inset 0 1px 0 rgba(255,255,255,0.35), 0 1px 2px rgba(13,32,42,0.25)"
                : "inset 0 1px 2px rgba(13,32,42,0.12)",
            }}
          />
        );
      })}
    </div>
  );
}

export default function Admin({ onChanged }: { onChanged?: () => void }) {
  const [view, setView] = useState<AdminView | null>(null);
  const [delivering, setDelivering] = useState(false);

  const load = async () => {
    const r = await adminAction();
    if (r.ok) setView(r.data);
  };

  useEffect(() => {
    void load();
  }, []);

  const deliver = async () => {
    setDelivering(true);
    const r = await deliverAction();
    if (r.ok) setView(r.data);
    setDelivering(false);
    onChanged?.();
  };

  if (!view) {
    return <p className="fineprint">読み込んでいます…</p>;
  }

  return (
    <div>
      <div
        className="card card--raised"
        style={{
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "1rem",
        }}
      >
        <div>
          <div style={{ display: "flex", alignItems: "baseline", gap: "0.45rem" }}>
            <span className={view.pending === 0 ? "stat stat--zero" : "stat"}>{view.pending}</span>
            <span className="body-text">件 未配信</span>
          </div>
          <p className="fineprint">本番は毎週月曜に自動配信。デモではここから手動で配信します</p>
        </div>
        <Btn variant="accent" onClick={deliver} disabled={view.pending === 0 || delivering}>
          {delivering ? "配信しています…" : "いま配信する"}
        </Btn>
      </div>

      <h2 className="label" style={{ margin: "2.25rem 0 0.9rem" }}>
        部署ごとの状態
      </h2>

      <div style={{ display: "grid", gap: "0.75rem" }}>
        {view.depts.map((e) => (
          <div
            key={e.dept}
            className="card"
            style={{
              display: "flex",
              flexWrap: "wrap",
              alignItems: "center",
              justifyContent: "space-between",
              gap: "1rem",
              padding: "1.1rem 1.375rem",
            }}
          >
            <div>
              <div style={{ fontSize: "0.95rem", fontWeight: 700 }}>{e.dept}</div>
              <p className="fineprint">{e.detail}</p>
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
              {e.level !== null && <Meter level={e.level} />}
              <span
                style={{
                  fontSize: "0.85rem",
                  fontWeight: e.level === null ? 400 : 700,
                  color:
                    e.level === null ? "var(--faint)" : e.level >= 4 ? "var(--stop)" : "var(--ink)",
                  whiteSpace: "nowrap",
                }}
              >
                {e.label}
              </span>
            </div>
          </div>
        ))}
      </div>

      <p className="fineprint" style={{ marginTop: "1.5rem", maxWidth: "36rem" }}>
        申告がゼロの部署は「データなし」と表示します。健全なのか、誰も声を上げられないのかは、この数字だけでは区別できないためです。
        集計するのは配信済みの申告だけです。送信直後に数字が動くと、誰が書いたか推測されてしまうためです。
        各部署にこの評価は開示されません。
      </p>

      <h2 className="label" style={{ margin: "2.25rem 0 0.9rem" }}>
        人事への引き継ぎ{view.escalations.length > 0 && `（${view.escalations.length} 件）`}
      </h2>

      {view.escalations.length === 0 ? (
        <p className="fineprint">ありません</p>
      ) : (
        <div style={{ display: "grid", gap: "0.75rem" }}>
          {view.escalations.map((e) => (
            <article key={e.id} className="card" style={{ padding: "1.1rem 1.375rem" }}>
              <div
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  alignItems: "baseline",
                  justifyContent: "space-between",
                  gap: "0.5rem 1rem",
                }}
              >
                <span style={{ fontSize: "0.95rem", fontWeight: 700 }}>{e.authorName}</span>
                <span className="fineprint">{new Date(e.createdAt).toLocaleString("ja-JP")}</span>
              </div>
              <div style={{ display: "grid", gap: "0.9rem", marginTop: "0.75rem" }}>
                <Field label="判定理由">{e.severityReason}</Field>
                <Field label="本人が書いた内容">{e.rawBody}</Field>
              </div>
            </article>
          ))}
        </div>
      )}

      <p className="fineprint" style={{ marginTop: "1.5rem", maxWidth: "36rem" }}>
        本人が実名での引き継ぎに同意したものだけが表示されます。匿名の申告とは別に扱い、部署ごとの状態には含めません。
      </p>
    </div>
  );
}
