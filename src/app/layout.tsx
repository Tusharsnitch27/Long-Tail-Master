import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = { title: { default: "Snitch Udaan", template: "%s · Snitch Udaan" }, description: "Snitch Udaan — building the next ₹100 Cr business across long-tail categories" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="font-sans">{children}</body>
    </html>
  );
}
