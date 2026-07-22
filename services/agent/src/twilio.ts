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
 * the exhibition. The trace still shows the real listed contact.
 */

export interface SmsResult {
  configured: boolean;
  sent: boolean;
  to: string;
  sid?: string;
  error?: string;
}

export interface SmsSender {
  configured: boolean;
  send(intendedTo: string, body: string): Promise<SmsResult>;
}

export function createSmsSender(env = process.env): SmsSender {
  const sid = env.TWILIO_ACCOUNT_SID?.trim();
  const token = env.TWILIO_AUTH_TOKEN?.trim();
  const from = env.TWILIO_FROM_NUMBER?.trim();
  const testTo = env.TWILIO_TEST_TO_NUMBER?.trim();

  const configured = Boolean(sid && token && from);

  return {
    configured,
    async send(intendedTo, body) {
      // For the demo, route to the verified test number if one is set; otherwise
      // to the number the record actually lists.
      const to = testTo || intendedTo;

      if (!configured) {
        return { configured: false, sent: false, to };
      }

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
          return { configured: true, sent: false, to, error: data.message ?? `HTTP ${res.status}` };
        }
        return { configured: true, sent: true, to, sid: data.sid };
      } catch (e) {
        return { configured: true, sent: false, to, error: e instanceof Error ? e.message : "send failed" };
      }
    },
  };
}
