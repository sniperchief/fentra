import { NextResponse } from "next/server";
import { getControlPlane } from "@/server/session";
import { agentIsConfigured, agentModel } from "@/agent/agent";

export const dynamic = "force-dynamic";

export async function GET() {
  const cp = getControlPlane();
  const [snapshot, connection] = await Promise.all([cp.getSnapshot(), cp.describeConnection()]);

  return NextResponse.json({
    snapshot,
    connection: { ...connection, venue: cp.venue },
    policy: cp.policy,
    history: cp.history.slice(0, 30),
    agentConfigured: agentIsConfigured(),
    agentModel: agentModel(),
  });
}
