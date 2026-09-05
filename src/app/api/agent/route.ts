import { NextResponse } from "next/server";
import type Anthropic from "@anthropic-ai/sdk";
import { getControlPlane } from "@/server/session";
import { runAgentTurn } from "@/agent/agent";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as {
    message?: string;
    history?: Anthropic.MessageParam[];
  };

  const message = (body.message ?? "").trim();
  if (!message) {
    return NextResponse.json({ error: "A message is required." }, { status: 400 });
  }

  try {
    const turn = await runAgentTurn(getControlPlane(), body.history ?? [], message);
    return NextResponse.json(turn);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "The agent failed to respond." },
      { status: 500 },
    );
  }
}
