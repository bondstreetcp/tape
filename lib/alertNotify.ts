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
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: isNtfy
        ? { Title: title, Priority: "high", Tags: "warning" }
        : { "Content-Type": "application/json" },
      // Slack wants {text}, Discord wants {content}, ntfy wants the raw string. Send all shapes at once.
      body: isNtfy ? msg : JSON.stringify({ text: msg, content: msg }),
    });
    console.log(res.ok ? "notifyAlert: webhook notified." : `notifyAlert: webhook HTTP ${res.status}`);
  } catch (e) {
    console.error("notifyAlert: webhook POST failed:", String((e as Error)?.message || e));
  }
}
