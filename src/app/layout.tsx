import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "言いにくいことを、届ける",
  description: "社内フィードバック（デモ）",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  );
}
