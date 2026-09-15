import "server-only";
import { callStructured } from "./client";
import { blurSchema } from "./schemas";
import { isStubMode, stubBlur } from "./stub";

const prompt = (text: string) =>
  `次の文面を、書き手が誰か推測されにくいように書き直してください。

条件:
- 特定の日付、二人きりの場面、その人しか知り得ない情報をぼかす
- 何があったか（行動）は残す。ここを消すと相手が認知できなくなる
- 書き手の言葉づかいはできるだけ残す

JSONのみを返すこと: {"blurred": "書き直した文面"}

対象:
"""
${text}
"""`;

/** 特定されにくい表現へ書き直す。採用するかどうかの判断は呼び出し元（＝本人）に残す。 */
export async function blur(text: string): Promise<string> {
  if (isStubMode()) return stubBlur(text);
  const r = await callStructured(blurSchema, prompt(text), { maxTokens: 800 });
  return r.blurred;
}
