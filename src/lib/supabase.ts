import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Supabase 接続。
 *
 * service_role キーを使うのは、認証を実装していないため。
 * RLS はユーザーを区別できないので「anon からは何も見えない、
 * サーバーだけが service_role で読み書きする」構成にしている
 * （schema.sql の権限セクション参照）。
 *
 * このファイルは server-only。クライアントから import された時点で
 * ビルドが落ちるため、service_role キーがブラウザに出ることはない。
 */

let client: SupabaseClient | null = null;

export function hasSupabase(): boolean {
  return !!(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

export function supabase(): SupabaseClient {
  if (!client) {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) {
      throw new Error(
        "SUPABASE_URL と SUPABASE_SERVICE_ROLE_KEY が未設定です（.env.local を確認してください）",
      );
    }
    client = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return client;
}

export const newId = (prefix: string): string =>
  `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
