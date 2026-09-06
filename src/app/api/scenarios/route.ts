import { NextResponse } from "next/server";
import { getControlPlane, resetDemoPositions, stageDrawdownFromPeak } from "@/server/session";
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
  const scenario = typeof id === "string" ? findScenario(id) : undefined;
  if (!scenario) {
    return NextResponse.json({ error: "Unknown scenario." }, { status: 400 });
  }

  // Scenarios submit a real proposal, and the drawdown one stages a fabricated
  // equity to trip the breaker. That is exactly the point on the demo venue and
  // on the Binance futures testnet, where the funds are not real and a latched
  // halt is cleared by Reset session.
  //
  // Against a real-funds account it is not: the sizes here are fixed at $2,000
  // and $5,000, and an invented equity would drive a live risk decision. So the
  // one venue this is refused on is BINANCE_LIVE.
  const cp = getControlPlane();
  if (cp.venue === "BINANCE_LIVE") {
    return NextResponse.json(
      {
        error:
          "Proof scenarios are refused against a real-funds account. They submit fixed-size " +
          "orders and stage a fabricated drawdown, which must not drive a decision on live " +
          "funds. Run them on the futures testnet (BINANCE_TESTNET=true) or in demo mode.",
      },
      { status: 409 },
    );
  }

  // Each scenario starts from the seeded baseline so it demonstrates its own
  // rule. The halt latch survives this, so scenario 4 keeps halting afterwards.
  resetDemoPositions();

  if (scenario.stageDrawdown) {
    // Staged against the account's own equity, so the drawdown is a real
    // percentage of a real balance on whichever venue is connected.
    const { equity } = await cp.getAccountState();
    stageDrawdownFromPeak(equity, scenario.stageDrawdown.breachPct);
  }

  const result = await cp.submitProposal(scenario.trade, {
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
