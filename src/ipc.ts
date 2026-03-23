import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { StringDecoder } from "node:string_decoder";
import type { Binding, Bindings } from "./bindings";
import type { Clip } from "./clip";
import type { Stream } from "./handler";
import { createIPCManifest, type IPCManifest } from "./manifest";

// === IPC Protocol Types ===

type MessageType = "register" | "registered" | "invoke" | "result" | "error" | "chunk" | "done";

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

interface ResultMessage extends BaseMessage {
  type: "result";
  id: string;
  output: unknown;
}

interface ErrorMessage extends BaseMessage {
  type: "error";
  id: string;
  error: string;
}

interface ChunkMessage extends BaseMessage {
  type: "chunk";
  id: string;
  output: unknown;
}

interface DoneMessage extends BaseMessage {
  type: "done";
  id: string;
}

// === State ===

const pendingInvokes = new Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
let idCounter = 0;
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

function nextId(): string {
  return `c${++idCounter}`;
}

function send(msg: Record<string, unknown>): void {
  process.stdout.write(JSON.stringify(msg) + "\n");
}

// === Public API ===

export async function invoke(slot: string, command: string, input: unknown): Promise<unknown> {
  const binding = bindings[slot];
  const id = nextId();

  return new Promise((resolve, reject) => {
    pendingInvokes.set(id, { resolve, reject });
    send({
      id,
      type: "invoke",
      clip: binding?.alias ?? slot,
      command,
      input,
      hub: binding?.hub,
      hub_token: binding?.hub_token,
      clip_token: binding?.clip_token,
    });
  });
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

  // Read messages from stdin
  const reader = createLineReader(process.stdin);
  const commands = clip.getCommands();

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
        const inv = msg as InvokeMessage;
        handleInvoke(inv, commands);
        break;
      }

      case "result": {
        const res = msg as ResultMessage;
        const pending = pendingInvokes.get(res.id);
        if (pending) {
          pendingInvokes.delete(res.id);
          pending.resolve(res.output);
        }
        break;
      }

      case "error": {
        const err = msg as ErrorMessage;
        const pending = pendingInvokes.get(err.id);
        if (pending) {
          pendingInvokes.delete(err.id);
          pending.reject(new Error(err.error));
        }
        break;
      }

      case "chunk": {
        // Streaming chunks — currently ignored on client side
        // Future: could accumulate or forward to a stream callback
        break;
      }

      case "done": {
        const done = msg as DoneMessage;
        const pending = pendingInvokes.get(done.id);
        if (pending) {
          pendingInvokes.delete(done.id);
          pending.resolve(undefined);
        }
        break;
      }

      default:
        process.stderr.write(`[ipc] unknown message type: ${msg.type}\n`);
    }
  }

  // Clean up pending invokes on EOF
  for (const [id, pending] of pendingInvokes) {
    pending.reject(new Error("IPC connection closed"));
  }
  pendingInvokes.clear();
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
