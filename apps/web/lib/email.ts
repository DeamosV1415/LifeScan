/**
 * Minimal transactional email via Resend's REST API.
 *
 * Called over fetch rather than the SDK to avoid another dependency — one POST
 * with a Bearer key is all the reset OTP needs. Dual-mode by the same spirit as
 * the rest of the stack: when RESEND_API_KEY is unset (local dev, or before the
 * key is added) it logs the message to the server console and reports
 * `delivered: false, dev: true`, so the whole reset flow is testable without an
 * email provider. Set RESEND_API_KEY (and optionally RESEND_FROM) to send for
 * real.
 */

const RESEND_ENDPOINT = "https://api.resend.com/emails";

export interface SendResult {
  delivered: boolean;
  /** True when we fell back to console logging because no key is configured. */
  dev: boolean;
  error?: string;
}

export async function sendEmail(opts: {
  to: string;
  subject: string;
  html: string;
  text: string;
}): Promise<SendResult> {
  const key = process.env.RESEND_API_KEY?.trim();
  const from = process.env.RESEND_FROM?.trim() || "LifeScan <onboarding@resend.dev>";

  if (!key) {
    // Dev fallback — surface the content so the flow is testable end-to-end.
    console.log(`[email:dev] to=${opts.to} subject="${opts.subject}"\n${opts.text}`);
    return { delivered: false, dev: true };
  }

  try {
    const res = await fetch(RESEND_ENDPOINT, {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({ from, to: [opts.to], subject: opts.subject, html: opts.html, text: opts.text }),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      console.error("[email] resend rejected", res.status, detail);
      return { delivered: false, dev: false, error: `email provider returned ${res.status}` };
    }
    return { delivered: true, dev: false };
  } catch (e) {
    console.error("[email] send failed", e instanceof Error ? e.message : e);
    return { delivered: false, dev: false, error: "email send failed" };
  }
}

/** The reset-code email, as matching HTML + plain-text parts. */
export function otpEmail(code: string, cardName: string): { subject: string; html: string; text: string } {
  const subject = `Your LifeScan card PIN reset code: ${code}`;
  const text =
    `Your LifeScan reset code is ${code}. It expires in 10 minutes.\n\n` +
    `Use it to reset the PIN on the card "${cardName}". ` +
    `If you didn't request this, you can ignore this email — your PIN is unchanged.`;
  const html = `
    <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;max-width:440px;margin:0 auto;padding:24px;color:#0b1220">
      <p style="font-size:12px;letter-spacing:.16em;text-transform:uppercase;color:#64748b;margin:0 0 4px">LifeScan · PIN reset</p>
      <p style="font-size:15px;line-height:1.5;margin:0 0 20px">Use this code to reset the PIN on your card <strong>${escapeHtml(cardName)}</strong>:</p>
      <p style="font-size:34px;font-weight:800;letter-spacing:.28em;margin:0 0 20px;color:#0b1220">${code}</p>
      <p style="font-size:13px;line-height:1.5;color:#475569;margin:0 0 8px">This code expires in 10 minutes and can be used once.</p>
      <p style="font-size:13px;line-height:1.5;color:#475569;margin:0">If you didn't request this, ignore this email — your PIN is unchanged.</p>
    </div>`;
  return { subject, html, text };
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );
}
