import type { Metadata } from "next";
import "./globals.css";

const iconSvgDataUrl =
  "data:image/svg+xml," +
  encodeURIComponent(
    `<svg width="512" height="512" viewBox="0 0 512 512" fill="none" xmlns="http://www.w3.org/2000/svg"><rect x="48" y="48" width="416" height="416" rx="92" fill="#155CE8"/><rect x="128" y="280" width="64" height="88" rx="16" fill="#9FC2FF"/><rect x="224" y="232" width="64" height="136" rx="16" fill="#CFE0FF"/><rect x="320" y="176" width="64" height="192" rx="16" fill="#FFFFFF"/><path d="M320 160L352 120L384 160" stroke="#FFFFFF" stroke-width="16" stroke-linecap="round" stroke-linejoin="round"/></svg>`
  );

export const metadata: Metadata = {
  title: "My Financial Portfolio",
  description: "Realtime portfolio tracker backed by Supabase and Fly.io quote worker",
  icons: {
    icon: [{ url: iconSvgDataUrl, type: "image/svg+xml" }],
    shortcut: [{ url: iconSvgDataUrl, type: "image/svg+xml" }]
  }
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
