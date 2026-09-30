import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = { title: { default: "Snitch Long Tail", template: "%s · Snitch Long Tail" }, description: "Snitch Long Tail — the operating tool for Snitch long-tail categories" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="font-sans">{children}</body>
    </html>
  );
}
