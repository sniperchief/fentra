import { NextResponse } from "next/server";
import { getControlPlane } from "@/server/session";
import { agentIsConfigured, agentModel } from "@/agent/agent";

export const dynamic = "force-dynamic";

export async function GET() {
  const cp = getControlPlane();

  try {
    const [snapshot, connection] = await Promise.all([cp.getSnapshot(), cp.describeConnection()]);

    return NextResponse.json({
      snapshot,
      connection: { ...connection, venue: cp.venue },
      policy: cp.policy,
      history: cp.history.slice(0, 30),
      agentConfigured: agentIsConfigured(),
      agentModel: agentModel(),
    });
  } catch (err) {
    // Account, positions and quotes all come from the venue, so an outage here
    // means there is no state to show. Say so rather than returning an
    // unhandled 500 that leaves the console waiting on a snapshot forever.
    return NextResponse.json(
      {
        error:
          "Could not read account state from the venue. " +
          (err instanceof Error ? err.message : "Unknown error."),
        venue: cp.venue,
      },
      { status: 503 },
    );
  }
}
