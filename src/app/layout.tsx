import type { Metadata, Viewport } from "next";
import { getDb } from "@/db";
import { getSettings } from "@/server/masters";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  try {
    const s = await getSettings(getDb());
    return { title: { default: s.appName, template: `%s | ${s.appName}` }, description: `${s.companyName} 経営管理システム`, robots: { index: false, follow: false } };
  } catch {
    return { title: "経営ナビ", robots: { index: false, follow: false } };
  }
}

export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#16223c" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja" className="h-full">
      <body className="min-h-full antialiased">{children}</body>
    </html>
  );
}
