"use client";

import { TopBar } from "@/ui/components/Shell";
import { AgentGuide } from "@/ui/components/AgentGuide";

/**
 * How other software talks to Fentra.
 *
 * Carries no application state and no verdicts — the console owns those. This
 * page is the integration surface: what to copy, and what it returns.
 */
export default function Agents() {
  return (
    <>
      <TopBar cta={{ label: "Run Console", href: "/app" }} />
      <AgentGuide />
    </>
  );
}
