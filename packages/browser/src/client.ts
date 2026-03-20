import type {
  BrowserCapability,
  ClickOptions,
  CookieResult,
  EvaluateOptions,
  EvaluateResult,
  NavigateOptions,
  NavigateResult,
  ScreenshotOptions,
  ScreenshotResult,
  TypeOptions,
  WaitForSelectorOptions,
} from "./types";

function getPinixUrl(): string {
  const url = process.env.PINIX_URL;
  if (!url) {
    throw new Error('Capability "browser" not available. Is pinixd running? (PINIX_URL not set)');
  }
  return url;
}

async function invokeCapability(
  capability: string,
  command: string,
  input: unknown,
): Promise<unknown> {
  const baseUrl = getPinixUrl();
  const res = await fetch(`${baseUrl}/api/capability/invoke`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ capability, command, input }),
  });

  const text = await res.text();
  if (!text || text.trim().length === 0) {
    throw new Error(`Capability ${capability}.${command}: empty response (HTTP ${res.status})`);
  }

  let data: Record<string, unknown>;
  try {
    data = JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new Error(`Capability ${capability}.${command}: invalid JSON response`);
  }

  if (!data || typeof data !== "object") {
    throw new Error(`Capability ${capability}.${command}: unexpected response format`);
  }

  if (data.error) {
    const err = typeof data.error === "object" ? (data.error as { message?: string }).message : String(data.error);
    throw new Error(err || `Capability ${capability}.${command} failed`);
  }

  return data;
}

export const browser: BrowserCapability = {
  async navigate(options: NavigateOptions): Promise<NavigateResult> {
    return invokeCapability("browser", "navigate", options) as Promise<NavigateResult>;
  },

  async click(options: ClickOptions): Promise<void> {
    await invokeCapability("browser", "click", options);
  },

  async type(options: TypeOptions): Promise<void> {
    await invokeCapability("browser", "type", options);
  },

  async evaluate(options: EvaluateOptions): Promise<EvaluateResult> {
    return invokeCapability("browser", "evaluate", options) as Promise<EvaluateResult>;
  },

  async waitForSelector(options: WaitForSelectorOptions): Promise<void> {
    await invokeCapability("browser", "waitForSelector", options);
  },

  async screenshot(options?: ScreenshotOptions): Promise<ScreenshotResult> {
    return invokeCapability("browser", "screenshot", options ?? {}) as Promise<ScreenshotResult>;
  },

  async getCookies(): Promise<CookieResult> {
    return invokeCapability("browser", "getCookies", {}) as Promise<CookieResult>;
  },
};
