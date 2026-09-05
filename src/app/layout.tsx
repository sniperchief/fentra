import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Fentra — AI Trading Risk Control",
  description:
    "The deterministic risk layer between autonomous AI agents and financial execution. Fentra evaluates every proposed trade against your risk policy, live account state, and market conditions — before it reaches Binance.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        {/* Loaded over the network with a full system fallback stack, so the
            app still renders correctly offline. */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap"
        />
      </head>
      <body className="min-h-screen bg-canvas font-sans text-ink antialiased">{children}</body>
    </html>
  );
}
