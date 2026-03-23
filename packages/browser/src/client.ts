import { invoke } from "../../src/index.ts";
// NOTE: When publishing, this should be changed to "@pinixai/core".
// Using relative path for monorepo development compatibility.
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

export const browser: BrowserCapability = {
  navigate: (opts: NavigateOptions) => invoke("browser", "navigate", opts) as Promise<NavigateResult>,
  click: (opts: ClickOptions) => invoke("browser", "click", opts) as Promise<void>,
  type: (opts: TypeOptions) => invoke("browser", "type", opts) as Promise<void>,
  evaluate: (opts: EvaluateOptions) => invoke("browser", "evaluate", opts) as Promise<EvaluateResult>,
  waitForSelector: (opts: WaitForSelectorOptions) => invoke("browser", "waitForSelector", opts) as Promise<void>,
  screenshot: (opts?: ScreenshotOptions) => invoke("browser", "screenshot", opts ?? {}) as Promise<ScreenshotResult>,
  getCookies: () => invoke("browser", "getCookies", {}) as Promise<CookieResult>,
};
