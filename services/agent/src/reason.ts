import OpenAI from "openai";
import { ACTION, type AgentChain } from "./chain.ts";
import { priceUsage, formatCost, type CostBreakdown } from "./cost.ts";
import { trace } from "./trace.ts";
import { formatEmergencySms, type SmsSender } from "./twilio.ts";

/**
 * The reasoning loop: OpenAI decides which tools to call; each tool both takes
 * its real-world action (trace + on-chain anchor) and returns a result the
 * model reasons over next. The loop ends when the model stops calling tools.
 *
 * Every tool call is anchored on-chain inside `execute`, so "autonomous AI
 * workflow", "smart contract execution" and "real-time transaction log" are all
 * the same event, produced live.
 */

const SYSTEM = `You are LifeScan's emergency triage co-pilot. A registered clinician has just
broken glass on an unconscious patient's record after a road accident. You are
triggered autonomously by that on-chain event.

You never treat and never move money. You surface the most dangerous facts to
the human clinician, fast, and hand off cleanly. Work in this order:

1. record_triage_assessment — the single most important contraindications and
   drug/allergy interactions, given the record AND the paramedic's context.
2. generate_sbar_handoff — a crisp SBAR note for the receiving team.
3. notify_emergency_contacts — the patient's listed contact.
4. push_to_er_dashboard — so the ER sees the patient before arrival.
5. generate_preauth_packet — a provisional insurance pre-auth (you PREPARE it;
   a human releases any funds).
If anything is ambiguous or conflicting, flag_for_human_review.

Be concise and clinical. Prioritise the immediately actionable danger.`;

const tools = [
  {
    type: "function" as const,
    name: "record_triage_assessment",
    description: "Record the critical triage findings. Call first.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        bloodGroup: { type: "string" },
        criticalAllergies: { type: "array", items: { type: "string" } },
        contraindications: {
          type: "array",
          items: { type: "string" },
          description: "Immediately actionable — e.g. drug the team is about to give.",
        },
        interactions: { type: "array", items: { type: "string" } },
        implantCautions: { type: "array", items: { type: "string" } },
      },
      required: ["bloodGroup", "criticalAllergies", "contraindications", "interactions", "implantCautions"],
    },
    strict: true,
  },
  {
    type: "function" as const,
    name: "generate_sbar_handoff",
    description: "Produce an SBAR handoff note for the receiving team.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        situation: { type: "string" },
        background: { type: "string" },
        assessment: { type: "string" },
        recommendation: { type: "string" },
      },
      required: ["situation", "background", "assessment", "recommendation"],
    },
    strict: true,
  },
  {
    type: "function" as const,
    name: "notify_emergency_contacts",
    description: "Notify the patient's listed emergency contact.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        name: { type: "string" },
        phone: { type: "string" },
        message: {
          type: "string",
          description:
            "A short, plain-language alert for the contact — 2-3 clear sentences: what happened, which hospital, and what to do. No jargon.",
        },
      },
      required: ["name", "phone", "message"],
    },
    strict: true,
  },
  {
    type: "function" as const,
    name: "push_to_er_dashboard",
    description: "Push an incoming-patient summary to the receiving ER.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        priority: { type: "string", enum: ["critical", "urgent", "standard"] },
        summary: { type: "string" },
      },
      required: ["priority", "summary"],
    },
    strict: true,
  },
  {
    type: "function" as const,
    name: "generate_preauth_packet",
    description: "Prepare a provisional insurance pre-authorisation. You prepare; a human releases funds.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        provisionalDiagnosis: { type: "string" },
        estimatedAmountInr: { type: "number" },
        itemization: { type: "array", items: { type: "string" } },
      },
      required: ["provisionalDiagnosis", "estimatedAmountInr", "itemization"],
    },
    strict: true,
  },
  {
    type: "function" as const,
    name: "flag_for_human_review",
    description: "Flag conflicting or low-confidence findings for a clinician.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: { reason: { type: "string" } },
      required: ["reason"],
    },
    strict: true,
  },
];

const ACTION_FOR_TOOL: Record<string, number> = {
  record_triage_assessment: ACTION.TRIAGE_ASSESSMENT,
  generate_sbar_handoff: ACTION.SBAR_HANDOFF,
  notify_emergency_contacts: ACTION.CONTACTS_NOTIFIED,
  push_to_er_dashboard: ACTION.ER_NOTIFIED,
  generate_preauth_packet: ACTION.PREAUTH_PACKET,
  flag_for_human_review: ACTION.FLAGGED_FOR_HUMAN,
};

const HUMAN_LABEL: Record<string, string> = {
  record_triage_assessment: "Triage assessment recorded",
  generate_sbar_handoff: "SBAR handoff generated",
  notify_emergency_contacts: "Emergency contact notified",
  push_to_er_dashboard: "Pushed to ER dashboard",
  generate_preauth_packet: "Insurance pre-auth packet prepared",
  flag_for_human_review: "Flagged for human review",
};

export interface ReasonResult {
  patientHash: string;
  actions: { tool: string; args: unknown; txHash: string }[];
  cost: CostBreakdown[];
  totalUsd: number;
}

export async function runTriage(params: {
  client: OpenAI;
  model: string;
  effort: "minimal" | "low" | "medium" | "high";
  chain: AgentChain;
  patientHash: `0x${string}`;
  record: unknown;
  paramedicContext: string;
  sms?: SmsSender;
}): Promise<ReasonResult> {
  const { client, model, effort, chain, patientHash, record, paramedicContext, sms } = params;

  const emit = (kind: Parameters<typeof trace.emitTrace>[0]["kind"], text: string, extra?: object) =>
    trace.emitTrace({ patientHash, kind, text, ...extra });

  const input: OpenAI.Responses.ResponseInput = [
    { role: "user", content: `${SYSTEM}\n\nPATIENT RECORD:\n${JSON.stringify(record, null, 2)}\n\nPARAMEDIC CONTEXT:\n${paramedicContext}` },
  ];

  const actions: ReasonResult["actions"] = [];
  const cost: CostBreakdown[] = [];

  async function execute(name: string, args: unknown): Promise<string> {
    emit("tool", HUMAN_LABEL[name] ?? name, { data: args });

    const actionType = ACTION_FOR_TOOL[name];
    const txHash = await chain.logAction(patientHash, actionType, args);
    actions.push({ tool: name, args, txHash });
    emit("chain", `${HUMAN_LABEL[name]} anchored on-chain`, { href: chain.explorerTx(txHash) });

    // Real-world side effect: the notify tool actually sends the SMS. The
    // on-chain anchor above proves the notification was issued; this delivers
    // it. A missing/failed Twilio credential never fails the run.
    let deliveredTo: string | undefined;
    if (name === "notify_emergency_contacts" && sms) {
      const c = args as { name?: string; phone?: string; message?: string };
      const body = formatEmergencySms(c.message ?? "A medical emergency alert has been issued.");
      const result = await sms.send(c.phone ?? "", body);
      const numbers = result.recipients.map((r) => r.to).join(", ");
      if (!result.configured) {
        emit("tool", `SMS not sent (Twilio not configured) — would notify ${numbers}`);
      } else {
        for (const r of result.recipients) {
          if (r.sent) emit("tool", `SMS delivered to ${r.to}`);
          else emit("error", `SMS to ${r.to} failed: ${r.error ?? "unknown error"}`);
        }
      }
      deliveredTo = result.recipients.filter((r) => r.sent).map((r) => r.to).join(",") || undefined;
    }

    return JSON.stringify({ ok: true, anchored: txHash, ...(deliveredTo ? { smsTo: deliveredTo } : {}) });
  }

  emit("reason", "Reasoning over the record and paramedic context…");

  for (let turn = 0; turn < 8; turn++) {
    const response = await client.responses.create({
      model,
      input,
      tools,
      reasoning: { effort },
      store: false,
    });

    const breakdown = priceUsage(model, response.usage as never);
    cost.push(breakdown);

    const calls = response.output.filter((o) => o.type === "function_call");

    // Persist the model's own turn output so the next call has full context.
    input.push(...response.output);

    if (calls.length === 0) {
      // Model produced a final message with no further tool calls.
      break;
    }

    for (const call of calls) {
      let args: unknown = {};
      try {
        args = JSON.parse(call.arguments);
      } catch {
        /* keep {} */
      }
      const output = await execute(call.name, args);
      input.push({ type: "function_call_output", call_id: call.call_id, output });
    }
  }

  const totalUsd = cost.reduce((sum, c) => sum + c.usd, 0);
  emit("done", `Triage complete · ${actions.length} actions anchored on-chain · $${totalUsd.toFixed(4)}`);
  for (const c of cost) console.log(`[agent] turn cost ${formatCost(c)}`);

  return { patientHash, actions, cost, totalUsd };
}
