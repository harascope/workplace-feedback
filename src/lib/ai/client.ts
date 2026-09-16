import "server-only";
import { GoogleGenAI } from "@google/genai";
import type { z } from "zod";

export const MODEL = "gemini-3.1-flash-lite";

let client: GoogleGenAI | null = null;

function getClient(): GoogleGenAI {
  if (!client) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error("GEMINI_API_KEY が設定されていません（.env.local を確認してください）");
    }
    client = new GoogleGenAI({ apiKey });
  }
  return client;
}

function extractJson(text: string): unknown {
  const cleaned = text
    .replace(/```json/gi, "")
    .replace(/```/g, "")
    .trim();
  // 前後に説明が混ざった場合に備えて最外の { } を拾う
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  const slice = start >= 0 && end > start ? cleaned.slice(start, end + 1) : cleaned;
  return JSON.parse(slice);
}

/**
 * プロンプトを投げ、zod スキーマで検証した値を返す。
 * パース・検証に失敗した場合は、失敗理由を添えて最大 maxRetries 回まで投げ直す。
 */
export async function callStructured<T>(
  schema: z.ZodType<T>,
  prompt: string,
  opts: { maxTokens?: number; maxRetries?: number } = {},
): Promise<T> {
  const { maxTokens = 1200, maxRetries = 2 } = opts;
  let lastError = "";

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const content =
      attempt === 0
        ? prompt
        : `${prompt}\n\n## 直前の出力は不正でした\n理由: ${lastError}\nJSONのみを、指定したキーと型のとおりに出力し直してください。`;

    const res = await getClient().models.generateContent({
      model: MODEL,
      contents: content,
      config: {
        // JSON で返させる。それでも崩れることはあるので extractJson と再試行は残す
        responseMimeType: "application/json",
        maxOutputTokens: maxTokens,
      },
    });

    const text = res.text ?? "";

    try {
      return schema.parse(extractJson(text));
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e);
    }
  }

  throw new Error(`構造化出力の取得に失敗しました: ${lastError}`);
}
