import { NextResponse } from "next/server";
import { getControlPlane, resetDemoPositions, stageDrawdown } from "@/server/session";
import { SCENARIOS, findScenario } from "@/server/scenarios";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({
    scenarios: SCENARIOS.map(({ id, title, expected, summary, trade }) => ({
      id,
      title,
      expected,
      summary,
      trade,
    })),
  });
}

export async function POST(req: Request) {
  const { id } = (await req.json().catch(() => ({}))) as { id?: string };
  const scenario = id ? findScenario(id) : undefined;
  if (!scenario) {
    return NextResponse.json({ error: `Unknown scenario ${id}` }, { status: 400 });
  }

  // Each scenario starts from the seeded baseline so it demonstrates its own
  // rule. The halt latch survives this, so scenario 4 keeps halting afterwards.
  resetDemoPositions();

  if (scenario.stageDrawdown) {
    stageDrawdown(scenario.stageDrawdown.peakEquity, scenario.stageDrawdown.currentEquity);
  }

  const result = await getControlPlane().submitProposal(scenario.trade, {
    agentRationale: scenario.trade.rationale,
  });

  return NextResponse.json({
    scenario: scenario.id,
    expected: scenario.expected,
    decision: result.decision,
    executed: result.executed,
    record: result.record,
  });
}
