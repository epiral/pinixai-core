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

  const data = await res.json() as Record<string, unknown>;

  if (data.error) {
    const err = data.error as { message?: string };
    throw new Error(err.message || `Capability ${capability}.${command} failed`);
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
