import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Fentra Console — Risk Control Plane",
  description:
    "Live control plane: agent proposals, deterministic risk evaluation, and the execution audit trail.",
};

export default function ConsoleLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
