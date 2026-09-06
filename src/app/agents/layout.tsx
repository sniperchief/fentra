import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Fentra for Agents — x402 and MCP",
  description:
    "Reach Fentra's deterministic risk engine from other software: pay per call over x402, or connect a local MCP client. Same ALLOW / BLOCK / HALT verdict, and neither surface can place an order.",
};

export default function AgentsLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
