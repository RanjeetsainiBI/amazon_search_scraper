import { chromium, type BrowserContext, type Page } from "playwright";
import { isBlocked } from "./parse.ts";

export interface BrowserOpts {
  headful: boolean;
  profileDir: string;
  /** "chrome" uses your installed Google Chrome instead of Playwright's Chromium. */
  channel?: string;
  minDelayMs: number;
  maxDelayMs: number;
}

export class CaptchaError extends Error {
  constructor() {
    super("Amazon showed a captcha");
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * One browser tab that visits pages at a human pace. The profile directory
 * keeps cookies between runs, which makes Amazon far less suspicious than a
 * fresh browser every time.
 */
export class PoliteBrowser {
  private ctx!: BrowserContext;
  private page!: Page;
  private last = 0;
  pagesLoaded = 0;

  constructor(private opts: BrowserOpts) {}

  async start() {
    this.ctx = await chromium.launchPersistentContext(this.opts.profileDir, {
      headless: !this.opts.headful,
      channel: this.opts.channel,
      // Optional: a specific Chromium/Chrome binary (BROWSER_PATH=/path/to/chrome).
      executablePath: process.env.BROWSER_PATH || undefined,
      locale: "en-IN",
      timezoneId: "Asia/Kolkata",
      viewport: { width: 1366, height: 900 },
      userAgent: this.opts.channel ? undefined : "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
    });
    this.page = this.ctx.pages()[0] ?? (await this.ctx.newPage());
  }

  async close() {
    await this.ctx?.close();
  }

  /** Loads a URL after a random pause and returns its HTML. Throws CaptchaError if Amazon blocks and nobody solves it. */
  async get(url: string): Promise<string> {
    const wait = this.opts.minDelayMs + Math.random() * (this.opts.maxDelayMs - this.opts.minDelayMs);
    const since = Date.now() - this.last;
    if (this.last && since < wait) await sleep(wait - since);

    await this.page.goto(url, { waitUntil: "domcontentloaded", timeout: 45_000 });
    await this.page.waitForTimeout(1200 + Math.random() * 800);
    // Product details and the seller block load lower on the page.
    await this.page.evaluate(() => window.scrollTo(0, document.body.scrollHeight * 0.7));
    await this.page.waitForTimeout(800 + Math.random() * 600);
    this.last = Date.now();
    this.pagesLoaded++;

    let html = await this.page.content();
    if (isBlocked(html)) html = await this.waitForHuman();
    return html;
  }

  /** In a visible window, gives you 5 minutes to solve the captcha; headless, stops the run. */
  private async waitForHuman(): Promise<string> {
    if (!this.opts.headful) throw new CaptchaError();
    console.log("\n⚠  Captcha in the browser window. Solve it there; the run continues by itself (waiting up to 5 min).");
    const until = Date.now() + 5 * 60_000;
    while (Date.now() < until) {
      await sleep(3000);
      const html = await this.page.content().catch(() => "");
      if (html && !isBlocked(html)) {
        console.log("✓  Captcha cleared, continuing.\n");
        await this.page.waitForTimeout(2000);
        return this.page.content();
      }
    }
    throw new CaptchaError();
  }
}
