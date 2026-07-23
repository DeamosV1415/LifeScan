/**
 * Emergency-contact SMS via Twilio.
 *
 * Deliberately a thin fetch against Twilio's REST API rather than the SDK: it
 * adds no dependency to the type-stripped runtime, and the Messages endpoint is
 * a single Basic-auth POST.
 *
 * It degrades gracefully. If Twilio is not configured the sender reports
 * `configured: false` and the agent still anchors the notification on-chain and
 * traces it — the demo never breaks for a missing credential.
 *
 * Trial-account note: a Twilio trial can only send to *verified* numbers, so
 * TWILIO_TEST_TO_NUMBER overrides the record's (fictional) contact number for
 * the exhibition. It accepts a comma-separated list, so several verified phones
 * (teammates on stage) all buzz at once. The trace still shows the real
 * listed contact.
 */

export interface SmsRecipientResult {
  to: string;
  sent: boolean;
  sid?: string;
  error?: string;
}

export interface SmsResult {
  configured: boolean;
  recipients: SmsRecipientResult[];
  sentCount: number;
}

export interface SmsSender {
  configured: boolean;
  send(intendedTo: string, body: string): Promise<SmsResult>;
}

export function createSmsSender(env = process.env): SmsSender {
  const sid = env.TWILIO_ACCOUNT_SID?.trim();
  const token = env.TWILIO_AUTH_TOKEN?.trim();
  const from = env.TWILIO_FROM_NUMBER?.trim();

  const configured = Boolean(sid && token && from);

  // Demo override: a comma-separated list of *verified* numbers to notify
  // instead of the record's fictional contact. Trial accounts can verify
  // several, so multiple teammates' phones light up at once.
  const overrideList = (env.TWILIO_TEST_TO_NUMBER ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  async function sendOne(to: string, body: string): Promise<SmsRecipientResult> {
    try {
      const auth = Buffer.from(`${sid}:${token}`).toString("base64");
      const res = await fetch(
        `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`,
        {
          method: "POST",
          headers: {
            authorization: `Basic ${auth}`,
            "content-type": "application/x-www-form-urlencoded",
          },
          body: new URLSearchParams({ To: to, From: from!, Body: body }).toString(),
        },
      );

      const data = (await res.json()) as { sid?: string; message?: string; code?: number };
      if (!res.ok) {
        return { to, sent: false, error: data.message ?? `HTTP ${res.status}` };
      }
      return { to, sent: true, sid: data.sid };
    } catch (e) {
      return { to, sent: false, error: e instanceof Error ? e.message : "send failed" };
    }
  }

  return {
    configured,
    async send(intendedTo, body) {
      // Route to the verified override list when set; otherwise to the number
      // the record actually lists.
      const recipients = overrideList.length > 0 ? overrideList : [intendedTo].filter(Boolean);

      if (!configured) {
        return {
          configured: false,
          recipients: recipients.map((to) => ({ to, sent: false })),
          sentCount: 0,
        };
      }

      const results = await Promise.all(recipients.map((to) => sendOne(to, body)));
      return { configured: true, recipients: results, sentCount: results.filter((r) => r.sent).length };
    },
  };
}
