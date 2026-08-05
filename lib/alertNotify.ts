import { deadline } from "./deadline";
/**
 * Shared alert delivery for the ops monitors (data freshness + LLM credits). POSTs a message to
 * ALERT_WEBHOOK_URL, auto-detecting Slack `{text}` / Discord `{content}` / ntfy.sh (raw body +
 * Title/Priority/Tags headers). No-op (just logs) when ALERT_WEBHOOK_URL is unset — the calling
 * script's `process.exit(1)` still yields GitHub's "workflow failed" email as the zero-config baseline.
 */
export async function notifyAlert(msg: string, title = "Tape alert", urlOverride?: string): Promise<void> {
  const url = urlOverride || process.env.ALERT_WEBHOOK_URL;
  if (!url) {
    console.log("(no webhook URL set — relying on GitHub's failed-run email)");
    return;
  }
  const isNtfy = /(^|\/\/)ntfy\.sh\//.test(url) || /\/\/ntfy\./.test(url);
  // ntfy takes the title as an HTTP HEADER, and fetch header values must be ByteString (Latin-1) —
  // an em-dash or arrow in the title throws "Cannot convert argument to a ByteString" BEFORE any
  // request is sent, i.e. the alert about the outage becomes its own silent outage. Found live
  // 2026-08-05 wiring the freshness gate in. ASCII-fold the header; the BODY stays raw UTF-8.
  const headerSafe = (s: string) => s.replace(/[^\x20-\x7E]/g, "-");
  try {
    const res = await fetch(url, {
      signal: deadline(10_000),
      method: "POST",
      headers: isNtfy
        ? { Title: headerSafe(title), Priority: "high", Tags: "warning" }
        : { "Content-Type": "application/json" },
      // Slack wants {text}, Discord wants {content}, ntfy wants the raw string. Send all shapes at once.
      body: isNtfy ? msg : JSON.stringify({ text: msg, content: msg }),
    });
    console.log(res.ok ? "notifyAlert: webhook notified." : `notifyAlert: webhook HTTP ${res.status}`);
  } catch (e) {
    console.error("notifyAlert: webhook POST failed:", String((e as Error)?.message || e));
  }
}
