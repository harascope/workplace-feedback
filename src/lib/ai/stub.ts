import "server-only";
import type { Analysis, Composed, Severity } from "./schemas";

/**
 * API キー無しでデモを動かすためのスタブ。
 *
 * GEMINI_API_KEY が未設定のときだけ使われる。キーを設定すれば実 API に切り替わり、
 * このファイルは一切呼ばれない。UI の分岐（欠落の促し・特定リスク・レベル3停止・
 * 権力差・まとめ配信）を確認するためのものであって、文面の質は実 API とは別物。
 */
export const isStubMode = (): boolean => !process.env.GEMINI_API_KEY;

const LEVEL3 = ["殴", "叩か", "蹴", "暴行", "脅", "殺す", "触ら", "性的", "わいせつ", "つきまと", "死にたい"];
const LEVEL2 = ["怒鳴", "無視", "仲間外れ", "毎回", "いつも", "続いて", "何度も", "残業", "押し付け"];

/** 外から観察できる動詞。ここに当たらない記述は「評価」として observable=false にする */
const OBSERVABLE = [
  "遮", "割り込", "言わ", "言っ", "送っ", "送ら", "無視", "返さ", "返って", "割り当て",
  "怒鳴", "呼ば", "頼ま", "書か", "指示", "聞か", "笑わ", "denied",
];
/** 書き手の評価・相手の内面。相手が認知できないので行動として扱わない */
const EVALUATIVE = ["態度", "感じ", "やる気", "嫌", "見下", "馬鹿にさ", "冷た", "雰囲気"];

const CONTEXT_HINTS = ["会議", "定例", "1on1", "ミーティング", "朝礼", "客先", "帰り", "昼", "先週", "先月", "昨日", "打ち合わせ", "席", "メール", "チャット"];
const IDENTIFYING = ["1on1", "二人", "2人", "個別", "面談", "私だけ", "自分だけ"];

const has = (s: string, words: string[]) => words.some((w) => s.includes(w));

function severityOf(body: string): { severity: Severity; reason: string } {
  if (has(body, LEVEL3)) return { severity: 3, reason: "暴力・脅迫等に該当しうる" };
  if (has(body, LEVEL2)) return { severity: 2, reason: "継続性または強い負荷がある" };
  return { severity: 1, reason: "単発の言動と読める" };
}

/** 文を切り出して、観察可能な行動かどうかを振り分ける */
function actionsOf(body: string) {
  const sentences = body
    .split(/[。\n]/)
    .map((s) => s.trim())
    .filter(Boolean);

  const source = sentences.length > 0 ? sentences : [body];
  return source.map((s) => ({
    description: s,
    observable: has(s, OBSERVABLE) || (!has(s, EVALUATIVE) && /(れ|られ|した|します|ます)/.test(s)),
  }));
}

export function stubAnalyze(body: string, candidateNames: string[]): Analysis {
  const { severity, reason } = severityOf(body);
  const actions = actionsOf(body);
  const contextHit = CONTEXT_HINTS.find((w) => body.includes(w)) ?? null;
  const target = candidateNames.find((n) => n.split(" ").some((part) => body.includes(part))) ?? null;
  const identifying = has(body, IDENTIFYING) || /\d{1,2}\s*[\/月]\s*\d{1,2}/.test(body);

  return {
    actions,
    context: contextHit ? `${contextHit}に関する場面` : null,
    targetHint: target,
    severity,
    severityReason: reason,
    identifiability: identifying ? "high" : "low",
    identifiabilityReason: identifying
      ? "その場にいた人数が限られ、書き手が絞り込まれる可能性があります"
      : "",
    organized: body.trim(),
  };
}

export function stubBlur(text: string): string {
  return text
    .replace(/1on1|個別面談|面談/g, "業務上のやりとりの中")
    .replace(/二人きり|二人|2人/g, "少人数")
    .replace(/\d{1,2}\s*[\/月]\s*\d{1,2}\s*日?/g, "先日")
    .replace(/私だけ|自分だけ/g, "一部の人");
}

export function stubCompose(text: string): Composed {
  return {
    what: text.trim(),
    why: "こうした受け止めが生まれると、相手は次から発言や相談を控えるようになることがあります。結果として、必要な情報が共有されにくくなる場合があります。",
    how: "一般に、こうした場面では、相手が話し終えるまで間を置く、意図が伝わっているかを確認する、といった対応が取られることがあります。",
  };
}
