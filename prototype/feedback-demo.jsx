import React, { useState } from "react";

/* ------------------------------------------------------------------ */
/*  パレット（Tailwind のコアクラスに無い色は inline style で指定）      */
/* ------------------------------------------------------------------ */
const C = {
  ink: "#191c22",
  sub: "#5c6270",
  faint: "#8d93a1",
  line: "#e0e0da",
  paper: "#fbfaf7",
  panel: "#ffffff",
  quiet: "#f3f2ee",
  signal: "#1f5f5b",
  warn: "#8a6316",
  warnBg: "#fdf6e6",
  stop: "#8c2f2f",
  stopBg: "#fbf0ef",
};

/* ------------------------------------------------------------------ */
/*  デモ用の社員名簿                                                    */
/* ------------------------------------------------------------------ */
const USERS = [
  { id: "u1", name: "山田 太郎", dept: "営業部", title: "メンバー", power: "peer" },
  { id: "u2", name: "佐藤 健一", dept: "営業部", title: "部長", power: "manager" },
  { id: "u3", name: "鈴木 花子", dept: "営業部", title: "メンバー", power: "peer" },
  { id: "u4", name: "高橋 みどり", dept: "開発部", title: "メンバー", power: "peer" },
  { id: "u5", name: "田中 誠", dept: "管理部", title: "役員", power: "executive" },
];
const userById = (id) => USERS.find((u) => u.id === id);

/* 初期状態に仕込んでおくダミー（デモ開始時点で少し溜まっている状態） */
const SEED = [
  {
    id: "r0",
    authorId: "u3",
    targetId: "u2",
    severity: 2,
    body: "先月の定例会議で、私が話している途中で話し始めることが3回ありました。",
    status: "delivered",
    composed: {
      what: "会議中、相手の発言の途中で話し始めることがありました。",
      why: "発言を最後まで聞かれない経験が続くと、相手は会議で意見を出すことをやめていきます。発言の機会が実質的に失われ、チームの意思決定に入る視点が減ります。",
      how: "相手が話し終えるまで一拍置く、話を遮ってしまったと気づいたら「続けてください」と戻す、といった対応が考えられます。",
    },
  },
  {
    id: "r1",
    authorId: "u4",
    targetId: "u2",
    severity: 1,
    body: "依頼のメッセージがいつも一言だけで、背景が分からないまま作業することがあります。",
    status: "pending",
    composed: null,
  },
];

/* ------------------------------------------------------------------ */
/*  Anthropic API                                                      */
/* ------------------------------------------------------------------ */
async function callClaude(prompt) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 1000,
      messages: [{ role: "user", content: prompt }],
    }),
  });
  const data = await res.json();
  const text = data.content
    .map((b) => (b.type === "text" ? b.text : ""))
    .join("")
    .replace(/```json/g, "")
    .replace(/```/g, "")
    .trim();
  return JSON.parse(text);
}

const ANALYZE_PROMPT = (body, names) => `あなたは職場フィードバックツールの解析エンジンです。従業員が書いた訴えを解析し、JSONのみを返してください。前置き・説明・マークダウンは一切出力しないこと。

## 解析の観点

1. actions: 相手が「した」こと。判定軸は外から観察できるかどうか。
   - 観察できる: 遮る、言う、送る、無視する、割り当てる
   - 観察できない: 態度が悪い、感じが悪い、やる気がない（これは書き手の評価であり、相手は認知できない）
   観察できない記述しか無い場合、actions は空配列にする。

2. context: いつ・どこで・どんな状況か。日付の精度は不要。「先週の定例で」程度で十分。無ければ null。

3. targetHint: 文中に相手の名前があれば返す。候補: ${names}。無ければ null。

4. severity:
   - 3 = 暴行・傷害、性的強要、脅迫、ストーカー行為、自死をほのめかす記述。犯罪または緊急対応の領域。
   - 2 = 継続的な暴言、無視・仲間外し、過大/過小な業務要求、プライバシー侵害。
   - 1 = 不適切な冗談、配慮を欠いた発言、単発の言動、業務上の不満。
   迷ったら重い方に寄せること。軽く見積もるミスの方が危険。

5. identifiability: この書き方だと、相手が「誰が書いたか」を推測できてしまう度合い。
   1on1、二人きりの場面、特定の日付、その人しか知り得ない情報などがあると high。

6. organized: 送信者が書いた内容を、相手が読む形に整えた文面。
   - 送信者が使った言葉をできるだけ残す。言い換えて意味を変えない。
   - 要望や感情を勝手に追加しない。事実として書かれたことだけ。
   - 1〜3文。

## 出力するJSON
{
  "actions": [{"description": "行動の記述", "observable": true}],
  "context": "場面" または null,
  "targetHint": "氏名" または null,
  "severity": 1,
  "severityReason": "判定理由を20字程度で",
  "identifiability": "low" | "medium" | "high",
  "identifiabilityReason": "推測されうる理由を30字程度で。lowなら空文字",
  "organized": "整えた文面"
}

## 解析対象
"""
${body}
"""`;

const BLUR_PROMPT = (text) => `次の文面を、書き手が誰か推測されにくいように書き直してください。

条件:
- 特定の日付、二人きりの場面、その人しか知り得ない情報をぼかす
- 何があったか（行動）は残す。ここを消すと相手が認知できなくなる
- 書き手の言葉づかいはできるだけ残す

JSONのみを返すこと: {"blurred": "書き直した文面"}

対象:
"""
${text}
"""`;

const COMPOSE_PROMPT = (text) => `あなたは職場フィードバックツールの文面生成エンジンです。匿名で寄せられた指摘を、受け取った人が行動を変えられる形に整えます。JSONのみを返してください。

## 絶対の原則
- 断定しない。「あなたはハラスメントをしました」ではなく「こういう受け止めをした人がいます」。事実認定はしていない。
- 人格ではなく行為を指す。「配慮のない人だ」ではなく「この場面でのこの行為」。
- 弁明の余地を残す。心当たりがない、意図が違った、という可能性は常にある。
- 責めない。相手を防御姿勢にさせた時点で失敗する。目的は認知であって断罪ではない。
- how は送信者の要望として書かない。「〇〇さんはこうしてほしいそうです」ではなく「一般に、こうした場面では」と切り離す。

## 出力するJSON
{
  "what": "指摘されている行為を1〜2文で。送信者の記述をほぼそのまま。",
  "why": "その行為がなぜ問題になりうるか。行為と影響を接続する。2〜3文。",
  "how": "一般的な対応の方向。2文程度。命令形にしない。"
}

## 指摘内容
"""
${text}
"""`;

/* ------------------------------------------------------------------ */
/*  小さな部品                                                          */
/* ------------------------------------------------------------------ */
function Notice({ tone = "quiet", title, children }) {
  const map = {
    quiet: { bg: C.quiet, bd: C.line, fg: C.ink },
    warn: { bg: C.warnBg, bd: "#e7d4a8", fg: C.warn },
    stop: { bg: C.stopBg, bd: "#e8c4c0", fg: C.stop },
  };
  const s = map[tone];
  return (
    <div
      className="px-4 py-3 mb-4"
      style={{ background: s.bg, border: `1px solid ${s.bd}`, borderRadius: 2 }}
    >
      {title && (
        <div className="text-sm font-semibold mb-1" style={{ color: s.fg }}>
          {title}
        </div>
      )}
      <div className="text-sm leading-relaxed" style={{ color: C.ink }}>
        {children}
      </div>
    </div>
  );
}

function Btn({ children, onClick, disabled, variant = "solid" }) {
  const base = "px-4 py-2 text-sm transition-colors disabled:opacity-40";
  const style =
    variant === "solid"
      ? { background: C.ink, color: "#fff", borderRadius: 2 }
      : variant === "ghost"
      ? { background: "transparent", color: C.ink, border: `1px solid ${C.line}`, borderRadius: 2 }
      : { background: C.signal, color: "#fff", borderRadius: 2 };
  return (
    <button className={base} style={style} onClick={onClick} disabled={disabled}>
      {children}
    </button>
  );
}

/* ------------------------------------------------------------------ */
/*  送る                                                               */
/* ------------------------------------------------------------------ */
function Compose({ me, onSend }) {
  const [body, setBody] = useState("");
  const [analysis, setAnalysis] = useState(null);
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
    try {
      const r = await callClaude(ANALYZE_PROMPT(body, candidates.map((u) => u.name).join("、")));
      setAnalysis(r);
      setBlurAccepted(false);
      if (r.targetHint) {
        const hit = candidates.find((u) => r.targetHint.includes(u.name.split(" ")[0]));
        if (hit) setTargetId(hit.id);
      }
    } catch (e) {
      setErr("解析に失敗しました。もう一度お試しください。");
    }
    setBusy(false);
  };

  const blur = async () => {
    setBusy(true);
    try {
      const r = await callClaude(BLUR_PROMPT(analysis.organized));
      setAnalysis({ ...analysis, organized: r.blurred, identifiability: "low" });
      setBlurAccepted(true);
    } catch (e) {
      setErr("書き直しに失敗しました。");
    }
    setBusy(false);
  };

  const reset = () => {
    setBody("");
    setAnalysis(null);
    setTargetId("");
    setPrompted(false);
    setDone(false);
  };

  if (done) {
    return (
      <div>
        <Notice tone="quiet" title="受け付けました">
          次回の配信は月曜です。すぐには届きません。送信直後に届くと、直前の出来事から誰が書いたか推測されてしまうためです。
          <div className="mt-2" style={{ color: C.sub }}>
            配信までの間は、取り消すことができます。
          </div>
        </Notice>
        <Btn variant="ghost" onClick={reset}>
          別の内容を書く
        </Btn>
      </div>
    );
  }

  const hasAction = analysis && analysis.actions && analysis.actions.some((a) => a.observable);
  const missingContext = analysis && !analysis.context;
  const level3 = analysis && analysis.severity === 3;
  const riskHigh = analysis && analysis.identifiability === "high" && !blurAccepted;
  const target = targetId ? userById(targetId) : null;
  const powerBlock = target && (target.power === "manager" || target.power === "executive");

  return (
    <div>
      <p className="text-sm mb-4 leading-relaxed" style={{ color: C.sub }}>
        職場で気になったことを、そのまま書いてください。どうしてほしいかまで書く必要はありません。
        誰に届くかは、書いたあとで選べます。
      </p>

      <textarea
        className="w-full p-4 text-sm leading-relaxed mb-3"
        style={{
          border: `1px solid ${C.line}`,
          borderRadius: 2,
          minHeight: 150,
          background: C.panel,
          color: C.ink,
        }}
        placeholder="例）会議で話している途中に割り込まれることが続いています"
        value={body}
        onChange={(e) => setBody(e.target.value)}
      />

      <div className="flex gap-2 items-center mb-6">
        <Btn onClick={analyze} disabled={!body.trim() || busy}>
          {busy ? "確認しています…" : "内容を確認する"}
        </Btn>
        {analysis && (
          <button className="text-sm underline" style={{ color: C.faint }} onClick={reset}>
            書き直す
          </button>
        )}
      </div>

      {err && <Notice tone="stop">{err}</Notice>}

      {/* レベル3：送信停止 */}
      {level3 && (
        <Notice tone="stop" title="このツールでは扱えません">
          <p className="mb-3">
            ここに書かれた内容は、このツールで扱える範囲を超えています。匿名のメッセージでは、あなたを守れません。
          </p>
          <p className="mb-1">相談先:</p>
          <ul className="list-disc pl-5 space-y-1" style={{ color: C.sub }}>
            <li>各都道府県労働局 総合労働相談コーナー</li>
            <li>警察相談専用電話 #9110</li>
            <li>法テラス（弁護士相談）</li>
          </ul>
          <p className="mt-3 text-xs" style={{ color: C.faint }}>
            書いた内容は保存されています。あなたが望めば、人事へ引き継ぐことができます。
          </p>
        </Notice>
      )}

      {/* 通常フロー */}
      {analysis && !level3 && (
        <div>
          <div
            className="p-4 mb-4"
            style={{ border: `1px solid ${C.line}`, borderRadius: 2, background: C.panel }}
          >
            <div className="text-xs mb-3" style={{ color: C.faint }}>
              読み取った内容
            </div>

            <div className="mb-3">
              <div className="text-xs mb-1" style={{ color: C.faint }}>
                何があったか
              </div>
              {hasAction ? (
                <ul className="text-sm space-y-1" style={{ color: C.ink }}>
                  {analysis.actions
                    .filter((a) => a.observable)
                    .map((a, i) => (
                      <li key={i}>{a.description}</li>
                    ))}
                </ul>
              ) : (
                <div className="text-sm" style={{ color: C.faint }}>
                  読み取れませんでした
                </div>
              )}
            </div>

            <div>
              <div className="text-xs mb-1" style={{ color: C.faint }}>
                どんな場面か
              </div>
              <div className="text-sm" style={{ color: analysis.context ? C.ink : C.faint }}>
                {analysis.context || "読み取れませんでした"}
              </div>
            </div>
          </div>

          {/* 欠落の促し（1回だけ。条件にはしない） */}
          {!prompted && (!hasAction || missingContext) && (
            <Notice tone="quiet" title={hasAction ? "場面が書かれていません" : "何があったかが書かれていません"}>
              {hasAction ? (
                <p>
                  相手が思い出せるよう、どんな場面だったかを足してもらえますか。日付まで正確でなくてかまいません。
                </p>
              ) : (
                <p>
                  今の書き方だと、相手は何を指しているか分からない可能性があります。相手が「した」ことを足してもらえますか。
                </p>
              )}
              <div className="mt-3 flex gap-2">
                <Btn variant="ghost" onClick={() => setPrompted(true)}>
                  このまま進む
                </Btn>
              </div>
            </Notice>
          )}

          {/* 特定リスク */}
          {riskHigh && (
            <Notice tone="warn" title="あなたが誰か、推測される可能性があります">
              <p className="mb-3">{analysis.identifiabilityReason}</p>
              <div className="flex gap-2">
                <Btn variant="ghost" onClick={() => setBlurAccepted(true)}>
                  このまま送る
                </Btn>
                <Btn variant="accent" onClick={blur} disabled={busy}>
                  {busy ? "書き直しています…" : "ぼかした表現に変える"}
                </Btn>
              </div>
            </Notice>
          )}

          {/* 送信先 */}
          {(prompted || (hasAction && !missingContext)) && !riskHigh && (
            <div>
              <div
                className="p-4 mb-4"
                style={{ border: `1px solid ${C.line}`, borderRadius: 2, background: C.panel }}
              >
                <div className="text-xs mb-2" style={{ color: C.faint }}>
                  相手に届く文面
                </div>
                <p className="text-sm leading-relaxed mb-4" style={{ color: C.ink }}>
                  {analysis.organized}
                </p>

                <div className="text-xs mb-2" style={{ color: C.faint }}>
                  誰に届けますか
                </div>
                <select
                  className="w-full p-2 text-sm"
                  style={{ border: `1px solid ${C.line}`, borderRadius: 2, background: C.panel, color: C.ink }}
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

              {powerBlock && (
                <Notice tone="warn" title="この相手には自動送信をおすすめしません">
                  {target.title}への匿名フィードバックは、報復のリスクが高くなります。この設定では自動送信が既定でオフになっていますが、送ることはできます。
                </Notice>
              )}

              <Btn
                onClick={() => {
                  onSend({
                    authorId: me.id,
                    targetId,
                    severity: analysis.severity,
                    body: analysis.organized,
                  });
                  setDone(true);
                }}
                disabled={!targetId}
              >
                送る
              </Btn>
              <span className="ml-3 text-xs" style={{ color: C.faint }}>
                誰が送ったかは、相手にも人事にも表示されません
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  受け取る                                                           */
/* ------------------------------------------------------------------ */
function Inbox({ me, reports, onRespond }) {
  const mine = reports.filter((r) => r.targetId === me.id && r.status === "delivered");

  if (mine.length === 0) {
    return (
      <div>
        <Notice tone="quiet" title="今回は届いていません">
          フィードバックは毎週月曜にまとめて届きます。届いていない週も、この画面でお知らせします。
        </Notice>
        <p className="text-xs leading-relaxed" style={{ color: C.faint }}>
          全員に毎週配信されます。届いた週だけ通知が来る仕組みにすると、受け取ったこと自体が周囲に伝わってしまうためです。
        </p>
      </div>
    );
  }

  return (
    <div>
      <p className="text-sm mb-5 leading-relaxed" style={{ color: C.sub }}>
        今週のフィードバックです。誰が書いたかは分かりません。事実として確定したものではなく、そう受け止めた人がいる、という記録です。
      </p>

      {mine.map((r) => (
        <div
          key={r.id}
          className="p-5 mb-4"
          style={{ border: `1px solid ${C.line}`, borderRadius: 2, background: C.panel }}
        >
          <div className="mb-4">
            <div className="text-xs mb-1" style={{ color: C.faint }}>
              指摘されている内容
            </div>
            <p className="text-sm leading-relaxed" style={{ color: C.ink }}>
              {r.composed ? r.composed.what : r.body}
            </p>
          </div>

          {r.composed && (
            <>
              <div className="mb-4">
                <div className="text-xs mb-1" style={{ color: C.faint }}>
                  なぜ問題になりうるか
                </div>
                <p className="text-sm leading-relaxed" style={{ color: C.ink }}>
                  {r.composed.why}
                </p>
              </div>
              <div className="mb-4">
                <div className="text-xs mb-1" style={{ color: C.faint }}>
                  一般的な対応
                </div>
                <p className="text-sm leading-relaxed" style={{ color: C.ink }}>
                  {r.composed.how}
                </p>
              </div>
            </>
          )}

          {!r.context && (
            <p className="text-xs mb-4" style={{ color: C.faint }}>
              特定の場面は示されていません。普段の言動として受け止めてください。
            </p>
          )}

          {r.response ? (
            <div className="text-xs pt-3" style={{ color: C.faint, borderTop: `1px solid ${C.line}` }}>
              {r.response === "ack" ? "「理解した」と回答済み" : "「認識が違う」と回答済み。記録されていますが、相手には自動では届きません。"}
            </div>
          ) : (
            <div className="flex gap-2 pt-3" style={{ borderTop: `1px solid ${C.line}` }}>
              <Btn variant="ghost" onClick={() => onRespond(r.id, "ack")}>
                理解した
              </Btn>
              <Btn variant="ghost" onClick={() => onRespond(r.id, "dispute")}>
                認識が違う
              </Btn>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  管理者                                                             */
/* ------------------------------------------------------------------ */
function Admin({ reports, onDeliver, delivering }) {
  const depts = [...new Set(USERS.map((u) => u.dept))];
  const pending = reports.filter((r) => r.status === "pending").length;

  const evaluate = (dept) => {
    const members = USERS.filter((u) => u.dept === dept).map((u) => u.id);
    const rs = reports.filter((r) => members.includes(r.targetId));
    if (rs.length === 0) return { label: "データなし", level: null, detail: "申告がありません" };

    const heavy = rs.filter((r) => r.severity >= 2).length;
    const ratio = heavy / rs.length;
    const targets = new Set(rs.map((r) => r.targetId));
    const level = Math.min(5, 1 + Math.round(ratio * 2) + (rs.length >= 2 ? 1 : 0));
    const concentration =
      targets.size === 1 && rs.length > 1 ? "特定の1名に集中" : "複数名に分散";
    return {
      level,
      label: `レベル ${level}`,
      detail: `重大度2以上が ${heavy}/${rs.length} ・ ${concentration}`,
    };
  };

  return (
    <div>
      <div
        className="p-4 mb-6 flex items-center justify-between"
        style={{ border: `1px solid ${C.line}`, borderRadius: 2, background: C.panel }}
      >
        <div>
          <div className="text-sm" style={{ color: C.ink }}>
            未配信 {pending} 件
          </div>
          <div className="text-xs mt-1" style={{ color: C.faint }}>
            通常は毎週月曜に自動配信されます
          </div>
        </div>
        <Btn variant="accent" onClick={onDeliver} disabled={pending === 0 || delivering}>
          {delivering ? "配信しています…" : "いま配信する"}
        </Btn>
      </div>

      <div className="text-xs mb-3" style={{ color: C.faint }}>
        部署ごとの状態
      </div>
      {depts.map((d) => {
        const e = evaluate(d);
        return (
          <div
            key={d}
            className="p-4 mb-3 flex items-baseline justify-between"
            style={{ border: `1px solid ${C.line}`, borderRadius: 2, background: C.panel }}
          >
            <div>
              <div className="text-sm font-semibold" style={{ color: C.ink }}>
                {d}
              </div>
              <div className="text-xs mt-1" style={{ color: C.sub }}>
                {e.detail}
              </div>
            </div>
            <div
              className="text-sm"
              style={{ color: e.level === null ? C.faint : e.level >= 4 ? C.stop : C.ink }}
            >
              {e.label}
            </div>
          </div>
        );
      })}

      <p className="text-xs leading-relaxed mt-5" style={{ color: C.faint }}>
        申告がゼロの部署は「データなし」と表示します。健全なのか、誰も声を上げられないのかは、この数字だけでは区別できないためです。
        各部署にこの評価は開示されません。
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  ルート                                                             */
/* ------------------------------------------------------------------ */
export default function App() {
  const [meId, setMeId] = useState("u3");
  const [tab, setTab] = useState("send");
  const [reports, setReports] = useState(SEED);
  const [delivering, setDelivering] = useState(false);

  const me = userById(meId);
  const inboxCount = reports.filter((r) => r.targetId === meId && r.status === "delivered").length;

  const send = (r) =>
    setReports((prev) => [...prev, { ...r, id: `r${Date.now()}`, status: "pending", composed: null }]);

  const deliver = async () => {
    setDelivering(true);
    const pending = reports.filter((r) => r.status === "pending");
    const composed = {};
    for (const r of pending) {
      try {
        composed[r.id] = await callClaude(COMPOSE_PROMPT(r.body));
      } catch (e) {
        composed[r.id] = null;
      }
    }
    setReports((prev) =>
      prev.map((r) =>
        r.status === "pending" ? { ...r, status: "delivered", composed: composed[r.id] } : r
      )
    );
    setDelivering(false);
  };

  const respond = (id, kind) =>
    setReports((prev) => prev.map((r) => (r.id === id ? { ...r, response: kind } : r)));

  const tabs = [
    { key: "send", label: "送る" },
    { key: "inbox", label: inboxCount > 0 ? `受け取る（${inboxCount}）` : "受け取る" },
    { key: "admin", label: "管理者" },
  ];

  return (
    <div className="min-h-screen" style={{ background: C.paper, color: C.ink }}>
      <div className="max-w-2xl mx-auto px-6 py-10">
        {/* ヘッダー */}
        <div className="flex items-baseline justify-between mb-8 pb-5" style={{ borderBottom: `1px solid ${C.line}` }}>
          <div>
            <h1 className="text-xl font-semibold tracking-tight">言いにくいことを、届ける</h1>
            <p className="text-xs mt-1" style={{ color: C.faint }}>
              社内フィードバック（デモ）
            </p>
          </div>
          <select
            className="p-2 text-sm"
            style={{ border: `1px solid ${C.line}`, borderRadius: 2, background: C.panel, color: C.ink }}
            value={meId}
            onChange={(e) => setMeId(e.target.value)}
          >
            {USERS.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}（{u.title}）
              </option>
            ))}
          </select>
        </div>

        {/* タブ */}
        <div className="flex gap-6 mb-8">
          {tabs.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className="text-sm pb-2"
              style={{
                color: tab === t.key ? C.ink : C.faint,
                borderBottom: tab === t.key ? `2px solid ${C.ink}` : "2px solid transparent",
                fontWeight: tab === t.key ? 600 : 400,
              }}
            >
              {t.label}
            </button>
          ))}
        </div>

        {tab === "send" && <Compose me={me} onSend={send} key={meId} />}
        {tab === "inbox" && <Inbox me={me} reports={reports} onRespond={respond} />}
        {tab === "admin" && <Admin reports={reports} onDeliver={deliver} delivering={delivering} />}

        <div className="mt-12 pt-5 text-xs" style={{ borderTop: `1px solid ${C.line}`, color: C.faint }}>
          <button className="underline" onClick={() => setReports(SEED)}>
            デモを初期状態に戻す
          </button>
        </div>
      </div>
    </div>
  );
}
