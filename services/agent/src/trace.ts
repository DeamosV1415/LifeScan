import { EventEmitter } from "node:events";

/**
 * The agent's live trace bus.
 *
 * Every meaningful step the agent takes is emitted here, and the SSE endpoint
 * relays it to the ER dashboard so judges watch the agent reason and act in
 * real time rather than seeing a finished result appear at once.
 */

export interface TraceEvent {
  patientHash: string;
  ts: number;
  kind: "trigger" | "perceive" | "reason" | "tool" | "chain" | "done" | "error";
  text: string;
  /** A Basescan link when the step produced an on-chain transaction. */
  href?: string;
  /** Structured payload for the dashboard (triage object, SBAR, etc.). */
  data?: unknown;
}

class TraceBus extends EventEmitter {
  private recent: TraceEvent[] = [];

  emitTrace(event: Omit<TraceEvent, "ts">) {
    const full: TraceEvent = { ...event, ts: Date.now() };
    // Keep a short backlog so a dashboard that connects mid-run still catches up.
    this.recent.push(full);
    if (this.recent.length > 200) this.recent.shift();
    this.emit("trace", full);
  }

  backlog(patientHash?: string): TraceEvent[] {
    return patientHash
      ? this.recent.filter((e) => e.patientHash.toLowerCase() === patientHash.toLowerCase())
      : this.recent;
  }
}

export const trace = new TraceBus();
