import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "My Financial Portfolio",
  description: "Realtime portfolio tracker backed by Supabase and Fly.io quote worker",
  icons: {
    icon: [{ url: "/brand/mfp-icon.svg", type: "image/svg+xml" }],
    shortcut: [{ url: "/brand/mfp-icon.svg", type: "image/svg+xml" }],
    apple: [{ url: "/brand/mfp-icon.svg", type: "image/svg+xml" }]
  }
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
