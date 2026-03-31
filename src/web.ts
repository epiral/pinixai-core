/**
 * @pinixai/core/web — Browser client for Clip Web UIs.
 *
 * Clip developers use invoke() and invokeStream() without caring
 * about the underlying transport:
 *
 *   import { invoke, invokeStream } from "@pinixai/core/web"
 *
 *   const config = await invoke<Config>("config", { args: ["get"] })
 *
 *   const cancel = invokeStream("send", { args: ["-p", "hello"] },
 *     (event) => console.log(event),
 *     (exitCode) => console.log("done", exitCode),
 *   )
 *
 * Transport is auto-detected:
 *   - Standalone (--web): HTTP POST /api/<command> + SSE streaming
 *   - Hub (pinixd / Cloud Hub): Connect-RPC Invoke RPC
 */

import { createHubClient, hubInvoke } from "@pinixai/hub-client";

// ── Public types ──

export interface InvokeOptions {
  args?: string[];
  stdin?: string;
}

export type StreamEvent =
  | { type: "info"; message: string }
  | { type: "text"; content: string }
  | { type: "thinking"; content: string }
  | { type: "tool_call"; name: string; arguments: string }
  | { type: "tool_result"; content: string }
  | { type: "inject"; content: string }
  | { type: "result"; data: unknown }
  | { type: "done" };

// ── Environment detection ──

interface StandaloneEnv {
  mode: "standalone";
}

interface HubEnv {
  mode: "hub";
  clipName: string;
  hubUrl: string;
}

type Env = StandaloneEnv | HubEnv;

const STREAM_EVENT_TYPES = new Set([
  "info", "text", "thinking", "tool_call", "tool_result", "inject", "result", "done",
]);

function isStreamEvent(value: unknown): value is StreamEvent {
  if (!value || typeof value !== "object") return false;
  const type = (value as { type?: unknown }).type;
  return typeof type === "string" && STREAM_EVENT_TYPES.has(type);
}

/**
 * Detect whether we're running standalone (--web) or inside a Hub (pinixd / Cloud Hub).
 *
 * Hub mode: page URL matches /clips/<clipName>/...
 * Standalone: everything else (typically root /)
 */
function detectEnv(): Env {
  const pathname = globalThis.location?.pathname ?? "/";
  const match = pathname.match(/^\/clips\/([^/]+)\//);
  if (match) {
    return {
      mode: "hub",
      clipName: match[1],
      hubUrl: globalThis.location.origin,
    };
  }
  return { mode: "standalone" };
}

// ── Standalone transport (HTTP + SSE) ──

async function httpInvoke(command: string, opts: InvokeOptions): Promise<unknown> {
  const response = await fetch(`api/${command}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(opts),
  });

  const text = await response.text();

  if (!response.ok) {
    const parsed = text ? tryParse(text) : null;
    const msg = extractError(parsed, `Command "${command}" failed (${response.status})`);
    throw new Error(msg);
  }

  return text ? JSON.parse(text) : null;
}

function httpInvokeStream(
  command: string,
  opts: InvokeOptions,
  onEvent: (event: StreamEvent) => void,
  onDone: (exitCode: number) => void,
): () => void {
  const controller = new AbortController();
  let cancelled = false;

  (async () => {
    let response: Response;
    try {
      response = await fetch(`api/${command}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Accept": "text/event-stream",
        },
        body: JSON.stringify(opts),
        signal: controller.signal,
      });
    } catch (error) {
      if (!cancelled) onDone(-1);
      return;
    }

    if (!response.ok || !response.body) {
      if (!cancelled) onDone(1);
      return;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const parts = buffer.split("\n\n");
        buffer = parts.pop() ?? "";

        for (const part of parts) {
          if (!part.trim()) continue;

          if (part.includes("event: done")) {
            onEvent({ type: "done" });
            continue;
          }

          const dataMatch = part.match(/^data:\s*(.+)$/m);
          if (!dataMatch) continue;

          try {
            const chunk = JSON.parse(dataMatch[1]);
            if (isStreamEvent(chunk)) {
              onEvent(chunk);
            } else if (chunk?.error) {
              onEvent({ type: "info", message: `Error: ${chunk.error}` });
            }
          } catch {
            // skip unparseable
          }
        }
      }

      if (!cancelled) onDone(0);
    } catch (error) {
      if (!cancelled) onDone(-1);
    }
  })();

  return () => {
    cancelled = true;
    controller.abort();
  };
}

// ── Hub transport (Connect-RPC via @pinixai/hub-client) ──

const encoder = new TextEncoder();
const decoder = new TextDecoder();

async function rpcInvoke(env: HubEnv, command: string, opts: InvokeOptions): Promise<unknown> {
  const client = createHubClient({ baseUrl: env.hubUrl });
  return hubInvoke(client, env.clipName, command, opts);
}

function rpcInvokeStream(
  env: HubEnv,
  command: string,
  opts: InvokeOptions,
  onEvent: (event: StreamEvent) => void,
  onDone: (exitCode: number) => void,
): () => void {
  const controller = new AbortController();
  let cancelled = false;

  (async () => {
    const client = createHubClient({ baseUrl: env.hubUrl });
    const input = encoder.encode(JSON.stringify(opts));

    try {
      for await (const response of client.invoke(
        { clipName: env.clipName, command, input, clipToken: "" },
        { signal: controller.signal },
      )) {
        if (cancelled) return;

        if (response.error) {
          onEvent({ type: "info", message: `Error: ${response.error.message}` });
          if (!cancelled) onDone(1);
          return;
        }

        if (response.output.length > 0) {
          const text = decoder.decode(response.output);
          for (const line of text.split("\n")) {
            const trimmed = line.trim();
            if (!trimmed) continue;
            try {
              const event = JSON.parse(trimmed);
              if (isStreamEvent(event)) {
                onEvent(event);
              }
            } catch {
              // skip non-JSON lines
            }
          }
        }
      }

      if (!cancelled) onDone(0);
    } catch (error) {
      if (!cancelled) onDone(-1);
    }
  })();

  return () => {
    cancelled = true;
    controller.abort();
  };
}

// ── Helpers ──

function tryParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function extractError(payload: unknown, fallback: string): string {
  if (typeof payload === "string" && payload.trim()) return payload;
  if (payload && typeof payload === "object") {
    const msg = (payload as { message?: string }).message;
    if (typeof msg === "string" && msg.trim()) return msg;
    const err = (payload as { error?: unknown }).error;
    if (typeof err === "string" && err.trim()) return err;
    if (err && typeof err === "object") {
      const nestedMsg = (err as { message?: string }).message;
      if (typeof nestedMsg === "string" && nestedMsg.trim()) return nestedMsg;
    }
  }
  return fallback;
}

// ── Public API ──

/**
 * Invoke a clip command and return the parsed result.
 *
 * Automatically uses HTTP (standalone --web) or Connect-RPC (Hub).
 */
export async function invoke<T = unknown>(
  command: string,
  opts: InvokeOptions = {},
): Promise<T> {
  const env = detectEnv();
  if (env.mode === "standalone") {
    return httpInvoke(command, opts) as Promise<T>;
  }
  return rpcInvoke(env, command, opts) as Promise<T>;
}

/**
 * Invoke a clip command with streaming output.
 * Returns a cancel function.
 *
 * Automatically uses SSE (standalone --web) or Connect-RPC streaming (Hub).
 */
export function invokeStream(
  command: string,
  opts: InvokeOptions,
  onEvent: (event: StreamEvent) => void,
  onDone: (exitCode: number) => void,
): () => void {
  const env = detectEnv();
  if (env.mode === "standalone") {
    return httpInvokeStream(command, opts, onEvent, onDone);
  }
  return rpcInvokeStream(env, command, opts, onEvent, onDone);
}
