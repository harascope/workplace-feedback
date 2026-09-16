import { z } from "zod";

/** 重大度。3 は送信停止（犯罪・緊急対応の領域）。仕様書 3.1 */
export const severitySchema = z.union([z.literal(1), z.literal(2), z.literal(3)]);
export type Severity = z.infer<typeof severitySchema>;

/** 特定リスク。書き手が誰か推測されうる度合い。仕様書 2.7 */
export const identifiabilitySchema = z.enum(["low", "medium", "high"]);
export type Identifiability = z.infer<typeof identifiabilitySchema>;

export const actionSchema = z.object({
  /** 相手が「した」こと。書き手の言葉をできるだけ残す */
  description: z.string(),
  /** 外から観察できるか。できないもの（態度が悪い等）は相手が認知できない */
  observable: z.boolean(),
});
export type Action = z.infer<typeof actionSchema>;

export const analysisSchema = z.object({
  actions: z.array(actionSchema),
  context: z.string().nullable(),
  targetHint: z.string().nullable(),
  severity: severitySchema,
  severityReason: z.string(),
  identifiability: identifiabilitySchema,
  identifiabilityReason: z.string(),
  /** 送信者が書いた内容を、相手が読む形に整えた文面 */
  organized: z.string(),
  /** actions が空で身体的特徴等に触れているときの、行動への言い換え案。無ければ null */
  rephraseHint: z.string().nullable().default(null),
});
export type Analysis = z.infer<typeof analysisSchema>;

export const blurSchema = z.object({ blurred: z.string() });
export type Blur = z.infer<typeof blurSchema>;

export const composedSchema = z.object({
  /** 何が指摘されているか（送信者の記述） */
  what: z.string(),
  /** なぜ問題になりうるか（AI） */
  why: z.string(),
  /** 一般的な対応の方向（AI）。送信者の要望として書かない */
  how: z.string(),
});
export type Composed = z.infer<typeof composedSchema>;
