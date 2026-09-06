"use client";

/**
 * Integration guide for machines, and for the people wiring them up.
 *
 * Every payment term on this page is read from `/api/risk/check/info` at
 * runtime rather than written into the markup. A hardcoded price or network
 * would go stale the first time the configuration changed, and a docs page that
 * quietly lies is worse than no docs page. It also means the snippets carry
 * whatever origin the page is served from, so tunnelling the server to a public
 * URL makes them copy-paste correct with no edit.
 */

import { useEffect, useState } from "react";
import { Button, Chip, Label, Panel, Status } from "./primitives";

/** Shape of the fields this page reads from the info endpoint. */
interface ServiceInfo {
  service: string;
  endpoint: string;
  url: string;
  price: string;
  network: string;
  payment: string;
  x402: {
    version: number;
    paymentHeader: string[];
    mode: "live" | "demo";
    modeDescription: string;
    settlement: string;
    accepts: Record<string, unknown>[];
  };
  request: { example: Record<string, unknown> };
}

/** Copy-to-clipboard code block. The reason this page exists. */
function Snippet({ label, code, lang }: { label: string; code: string; lang?: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // Clipboard is unavailable over plain http on some browsers; the text is
      // still selectable, so this fails quietly rather than alarming anyone.
    }
  }

  return (
    <div className="border border-line bg-paper">
      <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-2">
        <Label>{label}</Label>
        <div className="flex items-center gap-2">
          {lang ? (
            <span className="font-mono text-[10.5px] uppercase tracking-label text-faint">
              {lang}
            </span>
          ) : null}
          <Button onClick={copy} variant="quiet" className="px-2 py-1">
            {copied ? "Copied" : "Copy"}
          </Button>
        </div>
      </div>
      <pre className="overflow-x-auto px-4 py-3.5 font-mono text-[12.5px] leading-relaxed text-ash">
        {code}
      </pre>
    </div>
  );
}

export function AgentGuide() {
  const [info, setInfo] = useState<ServiceInfo | null>(null);
  const [origin, setOrigin] = useState("");
  const [probe, setProbe] = useState<{ status: number; body: unknown } | null>(null);
  const [probing, setProbing] = useState(false);

  useEffect(() => {
    setOrigin(window.location.origin);
    fetch("/api/risk/check/info", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setInfo(d))
      .catch(() => undefined);
  }, []);

  /**
   * Fires a genuine unpaid request and shows the real 402.
   *
   * Nothing is mocked and no wallet is needed: an unpaid call is a legitimate
   * part of the handshake, so this demonstrates the protocol honestly.
   */
  async function runProbe() {
    setProbing(true);
    try {
      const res = await fetch("/api/risk/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          symbol: "BTCUSDT",
          side: "BUY",
          type: "MARKET",
          notional: 2000,
          leverage: 20,
        }),
      });
      setProbe({ status: res.status, body: await res.json() });
    } catch {
      setProbe(null);
    } finally {
      setProbing(false);
    }
  }

  if (!info) {
    return (
      <div className="mx-auto max-w-[1100px] px-4 py-16 sm:px-6">
        <span className="font-mono text-[11px] uppercase tracking-label text-mute">
          Reading service contract…
        </span>
      </div>
    );
  }

  const endpoint = `${origin}/api/risk/check`;
  const demo = info.x402.mode === "demo";
  const local = /localhost|127\.0\.0\.1/.test(origin);
  const accepts = info.x402.accepts[0] ?? {};

  const jsSnippet = `import { wrapFetchWithPayment, createSigner } from "x402-fetch";

// Your agent's wallet. It needs ${info.price} per call and no gas:
// the facilitator submits the transfer and pays for it.
const signer = await createSigner("${accepts.network ?? info.network}", process.env.AGENT_PRIVATE_KEY);
const pay = wrapFetchWithPayment(fetch, signer);

const res = await pay("${endpoint}", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    symbol: "BTCUSDT", side: "BUY", type: "MARKET",
    notional: 2000, leverage: 20,
  }),
});

const { decision, reasons, metrics } = await res.json();
if (decision !== "ALLOW") {
  console.log("Stand down:", reasons.join(" "));
  return;                     // do not place the trade
}`;

  const curlSnippet = `# 1. Ask, unpaid. The server answers with its price.
curl -i -X POST ${endpoint} \\
  -H 'Content-Type: application/json' \\
  -d '{"symbol":"BTCUSDT","side":"BUY","type":"MARKET","notional":2000,"leverage":20}'
# HTTP/1.1 402 Payment Required

# 2. Retry with a base64 x402 payment payload.
curl -X POST ${endpoint} \\
  -H 'Content-Type: application/json' \\
  -H "${info.x402.paymentHeader[0]}: <base64 PaymentPayload>" \\
  -d '{"symbol":"BTCUSDT","side":"BUY","type":"MARKET","notional":2000,"leverage":20}'`;

  const mcpSnippet = `{
  "mcpServers": {
    "fentra": {
      "command": "npx",
      "args": ["tsx", "--env-file-if-exists=.env.local", "src/mcp/server.ts"],
      "cwd": "/absolute/path/to/fentra"
    }
  }
}`;

  return (
    <main className="mx-auto max-w-[1100px] px-4 py-10 sm:px-6">
      {/* ---- Header ------------------------------------------------- */}
      <div className="mb-8">
        <div className="flex items-center gap-2">
          <span aria-hidden className="h-[10px] w-[2px] bg-accent" />
          <Label className="text-accent">Agents</Label>
        </div>
        <h1 className="mt-3 text-[30px] font-semibold leading-tight tracking-[-0.025em] text-ink sm:text-[38px]">
          Two ways to reach the risk engine
        </h1>
        <p className="mt-3 max-w-[68ch] text-[15px] leading-relaxed text-ash">
          Fentra&apos;s deterministic verdict is available to other software, not just to the
          console. Pay per call over x402 from anywhere, or connect a local MCP client. Both return
          the same ALLOW / BLOCK / HALT the dashboard shows, from the same risk engine — and neither
          can place an order.
        </p>
      </div>

      {/* ---- Live terms --------------------------------------------- */}
      <Panel
        label="Live service contract"
        meta={
          <Status tone={demo ? "warn" : "ok"}>{demo ? "Demo mode" : "Live mode"}</Status>
        }
        className="mb-5"
      >
        <div className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-4">
          {[
            { label: "Price", value: info.price },
            { label: "Network", value: info.network },
            { label: "Protocol", value: `x402 v${info.x402.version}` },
            { label: "Scheme", value: String(accepts.scheme ?? "—") },
          ].map((m) => (
            <div key={m.label}>
              <Label>{m.label}</Label>
              <div className="mt-1.5 font-mono text-[14px] text-ink">{m.value}</div>
            </div>
          ))}
        </div>

        <div className="mt-5 grid gap-4 border-t border-line pt-4 sm:grid-cols-2">
          <div className="min-w-0">
            <Label>Pay to</Label>
            <div className="mt-1.5 truncate font-mono text-[12px] text-ash" title={String(accepts.payTo)}>
              {String(accepts.payTo ?? "—")}
            </div>
          </div>
          <div className="min-w-0">
            <Label>Asset</Label>
            <div className="mt-1.5 truncate font-mono text-[12px] text-ash" title={String(accepts.asset)}>
              {String(accepts.asset ?? "—")}
            </div>
          </div>
        </div>

        <p className="mt-4 text-[13px] leading-relaxed text-faint">{info.x402.modeDescription}</p>

        {local ? (
          <p className="mt-3 border-l-2 border-block/40 pl-3 text-[13px] leading-relaxed text-block">
            This server is on <span className="font-mono">{origin}</span>, which no external agent
            can reach. Expose it (for example <span className="font-mono">ngrok http 3000</span>) and
            reload this page — every snippet below will carry the public URL automatically.
          </p>
        ) : null}
      </Panel>

      {/* ---- Try it -------------------------------------------------- */}
      <Panel
        label="See the handshake"
        meta={
          <span className="font-mono text-[10.5px] uppercase tracking-label text-faint">
            real request · no wallet needed
          </span>
        }
        className="mb-5"
      >
        <div className="flex flex-wrap items-center gap-3">
          <Button onClick={runProbe} variant="primary" disabled={probing}>
            {probing ? "Requesting…" : "Send an unpaid request"}
          </Button>
          <span className="text-[13px] text-faint">
            Calls the endpoint with no payment. The 402 below is the genuine response.
          </span>
        </div>

        {probe ? (
          <div className="mt-4">
            <div className="mb-2 flex items-center gap-2">
              <Chip tone={probe.status === 402 ? "accent" : "warn"}>HTTP {probe.status}</Chip>
              <span className="font-mono text-[11px] uppercase tracking-label text-faint">
                Payment required
              </span>
            </div>
            <pre className="max-h-[280px] overflow-auto border border-line bg-canvas px-4 py-3 font-mono text-[12px] leading-relaxed text-ash">
              {JSON.stringify(probe.body, null, 2)}
            </pre>
          </div>
        ) : null}
      </Panel>

      {/* ---- x402 ---------------------------------------------------- */}
      <section className="mb-5">
        <h2 className="mb-3 flex items-center gap-2 font-mono text-[11.5px] font-medium uppercase tracking-label text-ink/70">
          <span aria-hidden className="h-[10px] w-[2px] bg-accent" />
          Option 1 — pay per call over x402
        </h2>
        <p className="mb-4 max-w-[70ch] text-[14px] leading-relaxed text-ash">
          Remote, and open to any agent. You do not implement the protocol: an x402 client wraps
          fetch, handles the 402, signs the payment and retries. Three lines of setup.
        </p>
        <div className="flex flex-col gap-4">
          <Snippet label="Install" lang="shell" code="npm install x402-fetch viem" />
          <Snippet label="Call it" lang="javascript" code={jsSnippet} />
          <Snippet label="Or raw HTTP" lang="shell" code={curlSnippet} />
        </div>
      </section>

      {/* ---- MCP ----------------------------------------------------- */}
      <section className="mb-5">
        <h2 className="mb-3 flex items-center gap-2 font-mono text-[11.5px] font-medium uppercase tracking-label text-ink/70">
          <span aria-hidden className="h-[10px] w-[2px] bg-accent" />
          Option 2 — connect over MCP
        </h2>
        <p className="mb-4 max-w-[70ch] text-[14px] leading-relaxed text-ash">
          Local and free, over stdio — for an agent running on the same machine, such as Claude
          Desktop or Cursor. Three read-only tools, no payment, and no tool that can trade.
        </p>

        <div className="mb-4 grid gap-2 sm:grid-cols-3">
          {[
            { name: "fentra_check_trade_risk", what: "Verdict for one proposed trade" },
            { name: "fentra_get_risk_policy", what: "The active limits" },
            { name: "fentra_get_risk_status", what: "Equity, exposure, halt state" },
          ].map((t) => (
            <div key={t.name} className="border border-line bg-paper px-3 py-2.5">
              <div className="truncate font-mono text-[11.5px] text-accent" title={t.name}>
                {t.name}
              </div>
              <div className="mt-1 text-[12.5px] leading-snug text-faint">{t.what}</div>
            </div>
          ))}
        </div>

        <Snippet label="Claude Desktop — claude_desktop_config.json" lang="json" code={mcpSnippet} />
        <p className="mt-3 text-[13px] leading-relaxed text-faint">
          Claude Code needs no setup: the repo ships a project-scoped{" "}
          <span className="font-mono">.mcp.json</span>.
        </p>
      </section>

      {/* ---- Response ------------------------------------------------ */}
      <section className="mb-5">
        <h2 className="mb-3 flex items-center gap-2 font-mono text-[11.5px] font-medium uppercase tracking-label text-ink/70">
          <span aria-hidden className="h-[10px] w-[2px] bg-accent" />
          What comes back
        </h2>
        <Snippet
          label="Response"
          lang="json"
          code={`{
  "decision": "BLOCK",
  "reasons": [
    "Position size: BTCUSDT exposure would reach $2,717.88, above the 20.00% of equity cap.",
    "Leverage: Requested 20x exceeds the 5x policy limit."
  ],
  "checks":  [ /* the five risk checks, each with the numbers behind it */ ],
  "metrics": { /* equity, exposure, leverage and drawdown after the trade */ },
  "payment": { "status": "verified", "mode": "live", "settled": false },
  "executed": false
}`}
        />
        <p className="mt-3 max-w-[70ch] text-[13px] leading-relaxed text-faint">
          Advisory only. <span className="font-mono">executed</span> is always false: this endpoint
          evaluates proposals and cannot reach the execution adapter under any input. Machine-readable
          service description at{" "}
          <a className="text-accent hover:underline" href="/api/risk/check/info">
            /api/risk/check/info
          </a>{" "}
          and{" "}
          <a className="text-accent hover:underline" href="/llms.txt">
            /llms.txt
          </a>
          .
        </p>
      </section>
    </main>
  );
}
