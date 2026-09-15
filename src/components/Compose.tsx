"use client";

import { useState } from "react";
import { analyzeAction, blurAction, sendAction } from "@/app/actions";
import type { Analysis } from "@/lib/ai/schemas";
import { USERS, isPowerSensitive, userById, type User } from "@/lib/data/users";
import { Btn, Field, Notice, Panel } from "./ui";

export default function Compose({ me }: { me: User }) {
  const [body, setBody] = useState("");
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [targetId, setTargetId] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [prompted, setPrompted] = useState(false);
  const [blurAccepted, setBlurAccepted] = useState(false);
  const [done, setDone] = useState(false);

  const candidates = USERS.filter((u) => u.id !== me.id);

  const analyze = async () => {
    setBusy(true);
    setErr("");
    const r = await analyzeAction(me.id, body);
    if (r.ok) {
      setAnalysis(r.data);
      setBlurAccepted(false);
      setPrompted(false);
      if (r.data.targetHint) {
        const hint = r.data.targetHint;
        const hit = candidates.find((u) => hint.includes(u.name.split(" ")[0]));
        if (hit) setTargetId(hit.id);
      }
    } else {
      setErr(r.error);
    }
    setBusy(false);
  };

  const blur = async () => {
    if (!analysis) return;
    setBusy(true);
    const r = await blurAction(analysis.organized);
    if (r.ok) {
      setAnalysis({ ...analysis, organized: r.data, identifiability: "low" });
      setBlurAccepted(true);
    } else {
      setErr(r.error);
    }
    setBusy(false);
  };

  const reset = () => {
    setBody("");
    setAnalysis(null);
    setTargetId("");
    setPrompted(false);
    setBlurAccepted(false);
    setErr("");
    setDone(false);
  };

  if (done) {
    return (
      <div>
        <Notice tone="quiet" title="受け付けました">
          次回の配信は月曜です。すぐには届きません。送信直後に届くと、直前の出来事から誰が書いたか推測されてしまうためです。
          <p style={{ marginTop: "0.6rem", color: "var(--sub)" }}>配信までの間は、取り消すことができます。</p>
        </Notice>
        <div style={{ marginTop: "1.25rem" }}>
          <Btn variant="ghost" onClick={reset}>
            別の内容を書く
          </Btn>
        </div>
      </div>
    );
  }

  const hasAction = !!analysis && analysis.actions.some((a) => a.observable);
  const missingContext = !!analysis && !analysis.context;
  const level3 = analysis?.severity === 3;
  const riskHigh = analysis?.identifiability === "high" && !blurAccepted;
  const target = targetId ? userById(targetId) : undefined;
  const powerBlock = !!target && isPowerSensitive(target);

  const send = async () => {
    if (!analysis || !targetId) return;
    setBusy(true);
    const r = await sendAction({
      authorId: me.id,
      targetId,
      severity: analysis.severity,
      body: analysis.organized,
      rawBody: body,
      hasContext: !!analysis.context,
    });
    setBusy(false);
    if (r.ok) setDone(true);
    else setErr(r.error);
  };

  return (
    <div>
      <p className="lede" style={{ marginBottom: "1.25rem", maxWidth: "36rem" }}>
        職場で気になったことを、そのまま書いてください。どうしてほしいかまで書く必要はありません。
        誰に届くかは、書いたあとで選べます。
      </p>

      <textarea
        className="textarea"
        placeholder="気になったことを書いてください"
        aria-label="気になったこと"
        value={body}
        onChange={(e) => setBody(e.target.value)}
      />

      <div style={{ display: "flex", alignItems: "center", gap: "0.9rem", margin: "1rem 0 2rem" }}>
        <Btn onClick={analyze} disabled={!body.trim() || busy}>
          {busy ? "確認しています…" : "内容を確認する"}
        </Btn>
        {analysis && (
          <button className="link-quiet" onClick={reset}>
            書き直す
          </button>
        )}
      </div>

      {err && (
        <Notice tone="stop" className="mb-4">
          {err}
        </Notice>
      )}

      {level3 && (
        <Notice tone="stop" title="このツールでは扱えません">
          <p>
            ここに書かれた内容は、このツールで扱える範囲を超えています。匿名のメッセージでは、あなたを守れません。
          </p>
          <p style={{ marginTop: "0.9rem", marginBottom: "0.2rem" }}>相談先</p>
          <ul style={{ listStyle: "disc", paddingLeft: "1.3rem", color: "var(--sub)" }}>
            <li>各都道府県労働局 総合労働相談コーナー</li>
            <li>警察相談専用電話 #9110</li>
            <li>法テラス（弁護士相談）</li>
          </ul>
          <p className="fineprint" style={{ marginTop: "0.9rem" }}>
            書いた内容は保存されています。あなたが望めば、人事へ引き継ぐことができます。
          </p>
        </Notice>
      )}

      {analysis && !level3 && (
        <div style={{ display: "grid", gap: "1.25rem" }}>
          <Panel>
            <span className="label">読み取った内容</span>

            <div style={{ display: "grid", gap: "1.1rem", marginTop: "0.9rem" }}>
              <Field label="何があったか" muted={!hasAction}>
                {hasAction ? (
                  <ul style={{ display: "grid", gap: "0.3rem" }}>
                    {analysis.actions
                      .filter((a) => a.observable)
                      .map((a, i) => (
                        <li key={i}>{a.description}</li>
                      ))}
                  </ul>
                ) : (
                  "読み取れませんでした"
                )}
              </Field>

              <Field label="どんな場面か" muted={!analysis.context}>
                {analysis.context ?? "読み取れませんでした"}
              </Field>
            </div>
          </Panel>

          {/* 欠落の促し。1回だけ。具体例も選択肢も出さない。条件にはしない */}
          {!prompted && (!hasAction || missingContext) && (
            <Notice
              tone="quiet"
              title={hasAction ? "場面が書かれていません" : "何があったかが書かれていません"}
            >
              {hasAction ? (
                <p>
                  相手が思い出せるよう、どんな場面だったかを足してもらえますか。日付まで正確でなくてかまいません。
                </p>
              ) : (
                <p>
                  今の書き方だと、相手は何を指しているか分からない可能性があります。相手が「した」ことを足してもらえますか。
                </p>
              )}
              <div style={{ marginTop: "0.9rem" }}>
                <Btn variant="ghost" onClick={() => setPrompted(true)}>
                  このまま進む
                </Btn>
              </div>
            </Notice>
          )}

          {riskHigh && (
            <Notice tone="warn" title="あなたが誰か、推測される可能性があります">
              <p>{analysis.identifiabilityReason}</p>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "0.6rem", marginTop: "0.9rem" }}>
                <Btn variant="ghost" onClick={() => setBlurAccepted(true)}>
                  このまま送る
                </Btn>
                <Btn variant="accent" onClick={blur} disabled={busy}>
                  {busy ? "書き直しています…" : "ぼかした表現に変える"}
                </Btn>
              </div>
            </Notice>
          )}

          {(prompted || (hasAction && !missingContext)) && !riskHigh && (
            <div style={{ display: "grid", gap: "1.25rem" }}>
              <Panel className="card--raised">
                <span className="label">相手に届く文面</span>
                <p
                  className="body-text"
                  style={{
                    marginTop: "0.5rem",
                    paddingBottom: "1.25rem",
                    borderBottom: "1px solid var(--line)",
                  }}
                >
                  {analysis.organized}
                </p>

                <div style={{ marginTop: "1.25rem" }}>
                  <label className="label" htmlFor="target">
                    誰に届けますか
                  </label>
                  <select
                    id="target"
                    className="field"
                    value={targetId}
                    onChange={(e) => setTargetId(e.target.value)}
                  >
                    <option value="">選んでください</option>
                    {candidates.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.name}（{u.dept}・{u.title}）
                      </option>
                    ))}
                  </select>
                </div>
              </Panel>

              {powerBlock && target && (
                <Notice tone="warn" title="この相手には自動送信をおすすめしません">
                  {target.title}
                  への匿名フィードバックは、報復のリスクが高くなります。この設定では自動送信が既定でオフになっていますが、送ることはできます。
                </Notice>
              )}

              <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "0.9rem" }}>
                <Btn onClick={send} disabled={!targetId || busy}>
                  {busy ? "送っています…" : "送る"}
                </Btn>
                <span className="fineprint">誰が送ったかは、相手にも人事にも表示されません</span>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
