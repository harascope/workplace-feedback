"use client";

import { useState } from "react";
import { analyzeAction, blurAction, cancelAction, escalateAction, sendAction } from "@/app/actions";
import type { Analysis } from "@/lib/ai/schemas";
import {
  EXTERNAL_CONTACTS,
  USERS,
  hrMentionedIn,
  isPowerSensitive,
  routeFor,
  userById,
  userFromHint,
  type User,
} from "@/lib/data/users";
import { Btn, Field, Notice, Panel } from "./ui";

export default function Compose({ me }: { me: User }) {
  const [body, setBody] = useState("");
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [targetId, setTargetId] = useState("");
  // 宛先を自分で選んだか。選んでいれば、解析結果による自動選択で上書きしない
  const [picked, setPicked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [prompted, setPrompted] = useState(false);
  const [blurAccepted, setBlurAccepted] = useState(false);
  // 取り消しに使う。画面を離れると失われるので、取り消せるのはこの画面にいる間だけ
  const [sentId, setSentId] = useState<string | null>(null);
  const [cancelled, setCancelled] = useState(false);
  const [escalated, setEscalated] = useState(false);

  const candidates = USERS.filter((u) => u.id !== me.id);

  /** 宛先の選択。「まだ決めない」に戻したら、また本文からの自動選択に委ねる */
  const choose = (id: string) => {
    setTargetId(id);
    setPicked(id !== "");
  };

  const analyze = async () => {
    setBusy(true);
    setErr("");
    const r = await analyzeAction(me.id, body);
    if (r.ok) {
      setAnalysis(r.data);
      setBlurAccepted(false);
      setPrompted(false);
      // 自分で選んでいればその宛先を優先する。未選択のときだけ本文から補う
      if (!picked && r.data.targetHint) {
        const hit = userFromHint(r.data.targetHint, candidates);
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
    setPicked(false);
    setPrompted(false);
    setBlurAccepted(false);
    setErr("");
    setSentId(null);
    setCancelled(false);
    setEscalated(false);
  };

  if (sentId) {
    const cancel = async () => {
      setBusy(true);
      setErr("");
      const r = await cancelAction(me.id, sentId);
      setBusy(false);
      if (r.ok) {
        setCancelled(true);
      } else {
        setErr(r.error);
      }
    };

    return (
      <div>
        {cancelled ? (
          <Notice tone="quiet" title="取り消しました">
            この内容は配信されません。
          </Notice>
        ) : (
          <Notice tone="quiet" title="受け付けました">
            次回の配信は月曜です。すぐには届きません。送信直後に届くと、直前の出来事から誰が書いたか推測されてしまうためです。
            {/* 失敗は配信済みのときだけなので、取り消せる案内は消す */}
            {!err && (
              <>
                <p style={{ marginTop: "0.6rem", color: "var(--sub)" }}>配信前であれば、この画面から取り消せます。</p>
                {/* sentId は state なので、タブを切り替えた時点で取り消す手段が消える。
                    「配信までならいつでも」と読まれないよう、有効範囲をその場で言い切る */}
                <p style={{ marginTop: "0.3rem", color: "var(--warn)" }}>
                  ただし、取り消せるのはこの画面にいる間だけです。タブを切り替えるか読み込み直すと、取り消せなくなります。
                </p>
              </>
            )}
          </Notice>
        )}
        {err && (
          <div style={{ marginTop: "1.25rem" }}>
            <Notice tone="stop">{err}</Notice>
          </div>
        )}
        <div style={{ display: "flex", flexWrap: "wrap", gap: "0.6rem", marginTop: "1.25rem" }}>
          {!cancelled && !err && (
            <Btn variant="ghost" onClick={cancel} disabled={busy}>
              {busy ? "取り消しています…" : "取り消す"}
            </Btn>
          )}
          <Btn variant="ghost" onClick={reset} disabled={busy}>
            別の内容を書く
          </Btn>
        </div>
      </div>
    );
  }

  // 同じ内容を二重に引き継がないよう、書く画面には戻さない
  if (escalated) {
    return (
      <div>
        <Notice tone="quiet">人事担当に、あなたの名前とともに届きました。</Notice>
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
  // 人事担当が書かれていれば、人事への引き継ぎは当事者に届きうるので出さない（仕様書 3.4）。
  // 対象者の読み取りが外れても引き継がない側に倒すため、本文も合わせて見る
  const hr = analysis ? hrMentionedIn(`${analysis.targetHint ?? ""}\n${body}`, candidates) : undefined;
  const hrNotice = hr ? routeFor(hr).notice : null;

  const escalate = async () => {
    if (!analysis) return;
    setBusy(true);
    setErr("");
    const r = await escalateAction({
      authorId: me.id,
      rawBody: body,
      severityReason: analysis.severityReason,
    });
    setBusy(false);
    if (r.ok) {
      setEscalated(true);
    } else {
      setErr(r.error);
    }
  };

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
    if (r.ok) {
      setSentId(r.data.id);
    } else {
      setErr(r.error);
    }
  };

  return (
    <div>
      <p className="lede" style={{ marginBottom: "0.5rem", maxWidth: "36rem" }}>
        職場で気になったことを、そのまま書いてください。どうしてほしいかまで書く必要はありません。
        誰に届けるかは、いま選んでも、書いたあとで選んでもかまいません。
      </p>
      {/* 一番ためらうのは書く前。匿名の約束は送信ボタンの直前ではなく、入力欄の上に置く（仕様書 1.2） */}
      <p className="lede" style={{ marginBottom: "1.25rem", color: "var(--brand-deep)" }}>
        誰が送ったかは、相手にも人事にも表示されません。
      </p>

      <textarea
        className="textarea"
        placeholder="気になったことを書いてください"
        aria-label="気になったこと"
        value={body}
        onChange={(e) => setBody(e.target.value)}
      />

      {/* 宛先は書いている最中から見える位置に置くが、任意のままにする（仕様書 2.2）。
          必須にすると、書く前に「誰かを名指しする」構えを要求することになる。
          確認画面のセレクタとは名前を変える。同じ名前の操作が2つあると取り違える */}
      <div style={{ marginTop: "1rem", maxWidth: "26rem" }}>
        <label className="label" htmlFor="target-early">
          誰に届けるか（任意）
        </label>
        <select id="target-early" className="field" value={targetId} onChange={(e) => choose(e.target.value)}>
          <option value="">まだ決めない（本文から自動で選ぶ）</option>
          {candidates.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name}（{u.dept}・{u.title}）
            </option>
          ))}
        </select>
        <p className="fineprint" style={{ marginTop: "0.35rem" }}>
          選ばなくても書けます。そのままなら、本文に出てくる名前から選ばれます。
        </p>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: "0.9rem", margin: "1rem 0 2rem" }}>
        <Btn onClick={analyze} disabled={!body.trim() || busy}>
          {busy ? "確認しています…" : "内容を確認する"}
        </Btn>
        {/* 押せない理由を書く。薄くなるだけだと、何を待たれているのか分からない */}
        {!body.trim() && <span className="fineprint">気になったことを書くと押せます</span>}
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
            {EXTERNAL_CONTACTS.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
          {hrNotice ? (
            <p style={{ marginTop: "0.9rem" }}>{hrNotice}</p>
          ) : (
            <p className="fineprint" style={{ marginTop: "0.9rem" }}>
              あなたが望めば、書いた内容を実名で人事へ引き継げます。引き継がない限り、どこにも保存されません。
            </p>
          )}
          {/* 引き継がずに抜ける出口を、赤枠の中にも置く（仕様書 2.4）。
              既存の出口と同じく書く画面に戻すだけで、新しい状態は増やさない */}
          <div style={{ display: "flex", flexWrap: "wrap", gap: "0.6rem", marginTop: "0.9rem" }}>
            {!hrNotice && (
              <Btn variant="ghost" onClick={escalate} disabled={busy}>
                {busy ? "引き継いでいます…" : "人事へ引き継ぐ"}
              </Btn>
            )}
            <Btn variant="ghost" onClick={reset} disabled={busy}>
              {hrNotice ? "別の内容を書く" : "いまは引き継がない"}
            </Btn>
          </div>
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

          {/* レベル2は送信を止めないが、報復リスクが比較的高いことを警告する（仕様書 3.1）。
              レベル1では出さない */}
          {analysis.severity === 2 && (
            <Notice tone="warn" title="報復のリスクが比較的高い内容です">
              <p>{analysis.severityReason}</p>
              <p style={{ marginTop: "0.6rem" }}>送るかどうかは、あなたが決められます。</p>
            </Notice>
          )}

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
                <>
                  <p>
                    今の書き方だと、相手は何を指しているか分からない可能性があります。相手が「した」ことを足してもらえますか。
                  </p>
                  {analysis.rephraseHint && (
                    <p style={{ marginTop: "0.6rem" }}>
                      例えば「{analysis.rephraseHint}」のように、相手の対応として書くと届けられます。
                    </p>
                  )}
                </>
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
                    onChange={(e) => choose(e.target.value)}
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
                /* いま何が起きているかだけを書く。「今オフなのか、押していいのか」で止まらせない（仕様書 3.4） */
                <Notice tone="warn" title="この相手には、自動で送らない設定です">
                  <p>
                    {target.title}への匿名フィードバックは、報復のリスクが高くなります。そのため、この相手あては自動で送らない設定になっています。
                  </p>
                  <p style={{ marginTop: "0.6rem" }}>
                    送信が止められているわけではありません。送るなら、下の「この内容を送る」を押してください。
                  </p>
                </Notice>
              )}

              <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "0.9rem" }}>
                {/* タブの「送る」と同名にしない。同じ画面に同じ名前の操作が2つあると取り違える */}
                <Btn onClick={send} disabled={!targetId || busy}>
                  {busy ? "送っています…" : "この内容を送る"}
                </Btn>
                <span className="fineprint">
                  {targetId ? "押すと、あなたの名前を伏せたまま相手に届きます" : "宛先を選ぶと押せます"}
                </span>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
