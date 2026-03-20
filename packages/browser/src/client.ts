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

async function invokeCapability(
  capability: string,
  command: string,
  input: unknown,
): Promise<unknown> {
  void capability;
  void command;
  void input;

  // MVP: connect to pinixd via PINIX_RUNTIME_SOCKET or a globally registered runtime.
  throw new Error(`Capability "${capability}" not available. Is pinixd running?`);
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
