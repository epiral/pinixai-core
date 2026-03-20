export interface NavigateOptions {
  url: string;
  waitUntil?: "load" | "domcontentloaded" | "networkidle";
}

export interface ClickOptions {
  selector: string;
}

export interface TypeOptions {
  selector: string;
  text: string;
  delay?: number;
}

export interface EvaluateOptions {
  js: string;
}

export interface WaitForSelectorOptions {
  selector: string;
  timeout?: number;
}

export interface ScreenshotOptions {
  fullPage?: boolean;
}

export interface NavigateResult {
  url: string;
  title: string;
}

export interface EvaluateResult {
  result: unknown;
}

export interface ScreenshotResult {
  base64: string;
}

export interface CookieResult {
  cookies: Array<{
    name: string;
    value: string;
    domain: string;
    path: string;
  }>;
}

export interface BrowserCapability {
  navigate(options: NavigateOptions): Promise<NavigateResult>;
  click(options: ClickOptions): Promise<void>;
  type(options: TypeOptions): Promise<void>;
  evaluate(options: EvaluateOptions): Promise<EvaluateResult>;
  waitForSelector(options: WaitForSelectorOptions): Promise<void>;
  screenshot(options?: ScreenshotOptions): Promise<ScreenshotResult>;
  getCookies(): Promise<CookieResult>;
}
