import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { StringDecoder } from "node:string_decoder";
import type { Binding, Bindings } from "./bindings";
import type { Clip } from "./clip";
import type { Stream } from "./handler";
import { hubInvoke } from "./hub";
import { createIPCManifest, type IPCManifest } from "./manifest";

// === IPC Protocol Types ===

type MessageType = "register" | "registered" | "invoke";

interface BaseMessage {
  type: MessageType;
  id?: string;
}

interface RegisterMessage extends BaseMessage {
  type: "register";
  manifest: IPCManifest;
}

interface RegisteredMessage extends BaseMessage {
  type: "registered";
  alias?: string;
}

interface InvokeMessage extends BaseMessage {
  type: "invoke";
  id: string;
  command?: string;
  clip?: string;
  input?: unknown;
  hub?: string;
  hub_token?: string;
  clip_token?: string;
}

// === State ===

let registeredAlias: string | undefined;
const bindings = loadBindings();

function loadBindings(): Bindings {
  const bindingsPath = join(dirname(Bun.main), "bindings.json");

  try {
    const parsed = JSON.parse(readFileSync(bindingsPath, "utf8")) as unknown;

    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }

    const loadedBindings: Bindings = {};
    for (const [slot, value] of Object.entries(parsed)) {
      const binding = normalizeBinding(value);
      if (binding) {
        loadedBindings[slot] = binding;
      }
    }

    return loadedBindings;
  } catch {
    return {};
  }
}

function normalizeBinding(value: unknown): Binding | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const candidate = value as Record<string, unknown>;
  const alias = asNonEmptyString(candidate.alias);

  if (!alias) {
    return null;
  }

  const binding: Binding = { alias };
  const hub = asNonEmptyString(candidate.hub);
  const hubToken = asNonEmptyString(candidate.hub_token);
  const clipToken = asNonEmptyString(candidate.clip_token);

  if (hub) {
    binding.hub = hub;
  }

  if (hubToken) {
    binding.hub_token = hubToken;
  }

  if (clipToken) {
    binding.clip_token = clipToken;
  }

  return binding;
}

function asNonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function send(msg: Record<string, unknown>): void {
  process.stdout.write(JSON.stringify(msg) + "\n");
}

// === Public API ===

export async function invoke(slot: string, command: string, input: unknown): Promise<unknown> {
  const binding = bindings[slot];
  const clipName = binding?.alias ?? slot;
  const clipToken = binding?.clip_token;
  const hubUrl = binding?.hub;

  return hubInvoke(clipName, command, input, clipToken, hubUrl);
}

// === Stdout Protection ===

export function redirectConsoleToStderr(): void {
  const write = (...args: unknown[]) => {
    process.stderr.write(args.map(String).join(" ") + "\n");
  };
  console.log = write;
  console.info = write;
  console.debug = write;
}

// === IPC Server ===

export async function serveIPC(clip: Clip): Promise<void> {
  // Redirect console.log to stderr so stdout is reserved for IPC
  redirectConsoleToStderr();

  // Register with pinixd
  const manifest = createIPCManifest(clip);
  send({ type: "register", manifest });

  // Idle timeout management
  const idleTimeout = (clip as Clip & { idleTimeout?: number }).idleTimeout ?? 30_000;
  let inflight = 0;
  let idleTimer: ReturnType<typeof setTimeout> | null = null;

  function clearIdleTimer(): void {
    if (idleTimer !== null) {
      clearTimeout(idleTimer);
      idleTimer = null;
    }
  }

  function resetIdleTimer(): void {
    clearIdleTimer();
    if (inflight > 0) return;
    if (!Number.isFinite(idleTimeout) || idleTimeout < 0) return;
    idleTimer = setTimeout(() => process.exit(0), idleTimeout);
  }

  // Read messages from stdin
  const reader = createLineReader(process.stdin);
  const commands = clip.getCommands();

  // Start idle timer after registration
  resetIdleTimer();

  for await (const line of reader) {
    let msg: BaseMessage;
    try {
      msg = JSON.parse(line) as BaseMessage;
    } catch {
      process.stderr.write(`[ipc] invalid JSON: ${line}\n`);
      continue;
    }

    if (!msg.type) {
      process.stderr.write(`[ipc] message missing type: ${line}\n`);
      continue;
    }

    switch (msg.type) {
      case "registered":
        registeredAlias = asNonEmptyString((msg as RegisteredMessage).alias);
        break;

      case "invoke": {
        clearIdleTimer();
        inflight++;
        const inv = msg as InvokeMessage;
        handleInvoke(inv, commands).finally(() => {
          inflight--;
          resetIdleTimer();
        });
        break;
      }

      default:
        process.stderr.write(`[ipc] unknown message type: ${msg.type}\n`);
    }
  }

  clearIdleTimer();
}

async function handleInvoke(
  msg: InvokeMessage,
  commands: ReturnType<Clip["getCommands"]>,
): Promise<void> {
  const cmd = commands.get(msg.command ?? "");
  if (!cmd) {
    send({ id: msg.id, type: "error", error: `unknown command: ${msg.command}` });
    return;
  }

  try {
    const parsed = await cmd.input.parseAsync(msg.input ?? {});
    let streamed = false;
    const stream: Stream = {
      chunk(data: unknown): void {
        streamed = true;
        send({ id: msg.id, type: "chunk", output: data });
      },
    };

    const output = await cmd.fn(parsed, stream);

    if (streamed) {
      send({ id: msg.id, type: "done" });
      return;
    }

    const validatedOutput = await cmd.output.parseAsync(output);
    send({ id: msg.id, type: "result", output: validatedOutput });
  } catch (err) {
    send({ id: msg.id, type: "error", error: err instanceof Error ? err.message : String(err) });
  }
}

// === Line Reader ===

async function* createLineReader(stream: NodeJS.ReadableStream): AsyncGenerator<string> {
  const decoder = new StringDecoder("utf8");
  let buffer = "";
  for await (const chunk of stream) {
    buffer += decoder.write(chunk as Buffer);
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (line.trim()) yield line;
    }
  }
  const remaining = decoder.end();
  if (remaining) buffer += remaining;
  if (buffer.trim()) yield buffer;
}
