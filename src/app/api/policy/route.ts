import { NextResponse } from "next/server";
import { getSession } from "@/server/session";
import { applyPolicyPatch } from "@/policy/policy-store";

export async function POST(req: Request) {
  const patch = await req.json().catch(() => ({}));
  const session = getSession();
  session.state.policy = applyPolicyPatch(session.state.policy, patch);
  return NextResponse.json({ policy: session.state.policy });
}
