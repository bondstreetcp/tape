/** GlobalMeet agenda adapter. Listen BEFORE clicking; the browser mints the token in its authorized session. */
import { chromium, type BrowserContext, type Page } from "playwright-core";
import { agendaDate, speakerLink, streamForTalk, webcastUrl, type ConferenceTalk } from "../lib/conferenceRunner";

export interface BrowserConfig { profile: string; channel: string; loginTimeoutMs: number; streamTimeoutMs: number; headless?: boolean }
export interface CapturedStream { url: string; referer: string; userAgent: string }

export class ConferenceBrowser {
  private constructor(public context: BrowserContext, public page: Page, private config: BrowserConfig) {}

  static async open(config: BrowserConfig): Promise<ConferenceBrowser> {
    // A separate persistent profile; never extract another browser's credentials or disable security checks.
    const context = await chromium.launchPersistentContext(config.profile, { channel: config.channel, headless: config.headless ?? false, chromiumSandbox: true });
    return new ConferenceBrowser(context, context.pages()[0] || await context.newPage(), config);
  }

  async discover(url: string): Promise<{ title: string; talks: ConferenceTalk[] }> {
    webcastUrl(url);
    await this.page.goto(url, { waitUntil: "domcontentloaded" });
    console.log("Waiting for the agenda. If registration appears, complete it in the runner's browser window.");
    await this.page.locator('a[onclick*="showSpeaker("]').first().waitFor({ timeout: this.config.loginTimeoutMs });
    const title = (await this.page.title()).replace(/\s*-\s*\d+$/, "");
    const dayLinks = await this.page.locator('a[onclick*="changeday("]').evaluateAll(nodes =>
      nodes.map(n => ({ label: n.textContent?.trim() || "", onclick: n.getAttribute("onclick") || "" })));
    const days = dayLinks.map(d => ({ ...d, date: agendaDate(d.onclick) })).filter(d => d.date);
    if (!days.length) throw new Error("Agenda has no supported dated tabs; no talks were captured.");
    const talks = new Map<string, ConferenceTalk>();
    for (const day of days) {
      await this.page.getByRole("link", { name: day.label, exact: true }).click();
      await this.page.waitForFunction((date) => {
        const normalized = new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", { month: "long", day: "2-digit", year: "numeric", timeZone: "UTC" });
        return document.body.innerText.includes(normalized);
      }, day.date, { timeout: 15000 });
      const links = await this.page.locator('a[onclick*="showSpeaker("]').evaluateAll(nodes =>
        nodes.map(n => ({ name: n.textContent?.trim() || "", onclick: n.getAttribute("onclick") || "" })));
      for (const link of links) {
        const parsed = speakerLink(link.onclick);
        if (parsed && link.name) talks.set(parsed.id, { ...parsed, name: link.name, date: day.date! });
      }
    }
    return { title, talks: [...talks.values()] };
  }

  async capture(talk: ConferenceTalk, consume: (stream: CapturedStream, context: BrowserContext) => Promise<void>): Promise<void> {
    // Closing the iframe stops old players and ensures each attempt requests a fresh stream.
    await this.closePlayer();
    const days = await this.page.locator('a[onclick*="changeday("]').evaluateAll(nodes =>
      nodes.map(n => ({ label: n.textContent?.trim() || "", onclick: n.getAttribute("onclick") || "" })));
    const day = days.find(d => agendaDate(d.onclick) === talk.date);
    if (!day) throw new Error("Talk date is no longer present in the agenda.");
    await this.page.getByRole("link", { name: day.label, exact: true }).click();
    const link = this.page.locator(`a[onclick*="ei=${talk.id}&"]`);
    await link.waitFor({ state: "visible", timeout: 15000 });
    const streamPromise = this.page.waitForResponse(r => streamForTalk(r.url(), talk.id) && r.ok(), { timeout: this.config.streamTimeoutMs });
    // Attach a rejection handler immediately; click/autoplay errors must not leave an unhandled timeout.
    void streamPromise.catch(() => {});
    await link.click();
    // Many GlobalMeet talks autoplay. If they don't, use the visible player control in the nested frame.
    const player = this.page.frameLocator("#popup").frameLocator("#media");
    await player.locator("#playerVdo").waitFor({ timeout: 20000 }).catch(() => {});
    const play = player.getByRole("button", { name: "Play", exact: true }).first();
    if (await play.isVisible().catch(() => false)) await play.click();
    try {
      const response = await streamPromise;
      const headers = await response.request().allHeaders();
      await consume({ url: response.url(), referer: headers.referer || "https://event.webcasts.com/", userAgent: headers["user-agent"] || "Mozilla/5.0" }, this.context);
    } finally { await this.closePlayer(); }
  }

  private async closePlayer(): Promise<void> {
    const close = this.page.frameLocator("#popup").getByRole("link", { name: "Close Player Button", exact: true });
    if (await close.isVisible().catch(() => false)) await close.click();
  }

  async close(): Promise<void> { await this.context.close(); }
}
