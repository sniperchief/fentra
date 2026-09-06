import { NextResponse } from "next/server";
import type Anthropic from "@anthropic-ai/sdk";
import { getControlPlane } from "@/server/session";
import { runAgentTurn } from "@/agent/agent";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Bounds on what a client may push into the model context. */
const MAX_MESSAGE_CHARS = 4000;
const MAX_HISTORY_TURNS = 20;

/**
 * The transcript arrives from the browser, so it is treated as input rather
 * than as trusted context: only plain user/assistant text turns are carried
 * forward. That keeps a caller from injecting fabricated tool results — a
 * forged "risk check passed" turn — into the agent conversation, and keeps an
 * oversized history from being forwarded to the model.
 *
 * It changes nothing the console itself sends: it posts exactly this shape.
 */
function sanitizeHistory(history: unknown): Anthropic.MessageParam[] {
  if (!Array.isArray(history)) return [];
  return history
    .filter(
      (m): m is { role: "user" | "assistant"; content: string } =>
        Boolean(m) &&
        typeof m === "object" &&
        ((m as { role?: unknown }).role === "user" ||
          (m as { role?: unknown }).role === "assistant") &&
        typeof (m as { content?: unknown }).content === "string",
    )
    .slice(-MAX_HISTORY_TURNS)
    .map((m) => ({ role: m.role, content: m.content.slice(0, MAX_MESSAGE_CHARS) }));
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as {
    message?: unknown;
    history?: unknown;
  };

  const message = (typeof body.message === "string" ? body.message : "").trim();
  if (!message) {
    return NextResponse.json({ error: "A message is required." }, { status: 400 });
  }
  if (message.length > MAX_MESSAGE_CHARS) {
    return NextResponse.json(
      { error: `A message may be at most ${MAX_MESSAGE_CHARS} characters.` },
      { status: 400 },
    );
  }

  try {
    const turn = await runAgentTurn(getControlPlane(), sanitizeHistory(body.history), message);
    return NextResponse.json(turn);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "The agent failed to respond." },
      { status: 500 },
    );
  }
}
