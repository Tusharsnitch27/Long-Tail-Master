import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = { title: "Long-Tail Ops · Snitch", description: "Perfumes & Shoes store performance, targets and SKU tracking" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="font-sans">{children}</body>
    </html>
  );
}
