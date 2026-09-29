import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = { title: { default: "Category Mitra", template: "%s · Category Mitra" }, description: "Snitch category operating system — stores, channels, products, inventory and actions" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="font-sans">{children}</body>
    </html>
  );
}
