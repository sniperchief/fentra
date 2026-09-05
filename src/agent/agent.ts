/**
 * The Fentra agent loop.
 *
 * A manual tool loop rather than the SDK tool runner, because the application
 * needs to intercept every `propose_trade` result to attach the risk report to
 * the UI transcript. The loop only ever calls `runTool`, which exposes read
 * tools plus `propose_trade`. Execution stays in the control plane.
 *
 * When ANTHROPIC_API_KEY is unset the app falls back to a deterministic
 * proposer so the risk-control demo still runs end to end without a model.
 */

import Anthropic from "@anthropic-ai/sdk";
import { systemPrompt } from "./prompts";
import { TOOL_DEFS, coerceProposal, runTool } from "./tools";
import { heuristicAgent } from "./heuristic-agent";
import type { ControlPlane } from "@/server/control-plane";
import type { TradeRecord } from "@/server/control-plane";

export interface AgentTurn {
  reply: string;
  /** Proposals made during this turn, newest last. */
  records: TradeRecord[];
  /** True when no model was used and the deterministic proposer answered. */
  usedFallback: boolean;
}

/**
 * Haiku 4.5 is the cheapest current model and is more than adequate here: the
 * agent reads a few tools, picks a size, and calls propose_trade. The financial
 * judgement is not the model's job, so paying for a larger one buys little.
 *
 * Override with FENTRA_MODEL. Note that `output_config.effort` is not
 * supported on Haiku 4.5 and is only sent for models that accept it.
 */
const MODEL = process.env.FENTRA_MODEL?.trim() || "claude-haiku-4-5";
const MAX_TOOL_ROUNDS = 8;

/** Effort is a 4.6+ parameter; sending it to Haiku 4.5 returns a 400. */
const supportsEffort = (model: string) => !/haiku-4-5|sonnet-4-5/.test(model);

export function agentModel(): string {
  return MODEL;
}

export function agentIsConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY?.trim());
}

export async function runAgentTurn(
  cp: ControlPlane,
  history: Anthropic.MessageParam[],
  userMessage: string,
): Promise<AgentTurn> {
  if (!agentIsConfigured()) {
    return heuristicAgent(cp, userMessage);
  }

  const client = new Anthropic();
  const messages: Anthropic.MessageParam[] = [
    ...history,
    { role: "user", content: userMessage },
  ];
  const proposalIds: string[] = [];

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 4000,
      system: systemPrompt(cp.policy),
      ...(supportsEffort(MODEL) ? { output_config: { effort: "low" as const } } : {}),
      tools: TOOL_DEFS,
      messages,
    });

    if (response.stop_reason !== "tool_use") {
      return {
        reply: textOf(response) || "No response produced.",
        records: collectRecords(cp, proposalIds),
        usedFallback: false,
      };
    }

    messages.push({ role: "assistant", content: response.content });

    // All tool calls in one assistant turn are executed and returned together,
    // in a single user message, as the API expects.
    const toolUses = response.content.filter(
      (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
    );
    const results: Anthropic.ToolResultBlockParam[] = [];

    for (const use of toolUses) {
      try {
        const outcome = await runTool(cp, use.name, use.input as Record<string, unknown>);
        if (outcome.proposalRecordId) proposalIds.push(outcome.proposalRecordId);
        results.push({ type: "tool_result", tool_use_id: use.id, content: outcome.content });
      } catch (err) {
        results.push({
          type: "tool_result",
          tool_use_id: use.id,
          is_error: true,
          content: err instanceof Error ? err.message : "Tool failed.",
        });
      }
    }

    messages.push({ role: "user", content: results });
  }

  return {
    reply: "Stopped after too many tool rounds without a final answer.",
    records: collectRecords(cp, proposalIds),
    usedFallback: false,
  };
}

function textOf(response: Anthropic.Message): string {
  return response.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();
}

function collectRecords(cp: ControlPlane, ids: string[]): TradeRecord[] {
  return ids
    .map((id) => cp.history.find((r) => r.id === id))
    .filter((r): r is TradeRecord => Boolean(r));
}

export { coerceProposal };
