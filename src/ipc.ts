import type { Clip } from "./clip";
import { createIPCManifest } from "./manifest";

// === IPC Protocol Types ===

type MessageType = "register" | "registered" | "invoke" | "result" | "error" | "chunk" | "done";

interface BaseMessage {
  type: MessageType;
  id?: string;
}

interface RegisterMessage extends BaseMessage {
  type: "register";
  manifest: { name: string; domain: string; commands: string[]; dependencies: string[] };
}

interface InvokeMessage extends BaseMessage {
  type: "invoke";
  id: string;
  command?: string;
  clip?: string;
  input?: unknown;
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

// === State ===

const pendingInvokes = new Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
let idCounter = 0;

function nextId(): string {
  return `c${++idCounter}`;
}

function send(msg: Record<string, unknown>): void {
  process.stdout.write(JSON.stringify(msg) + "\n");
}

// === Public API ===

export async function invoke(clip: string, command: string, input: unknown): Promise<unknown> {
  const id = nextId();
  return new Promise((resolve, reject) => {
    pendingInvokes.set(id, { resolve, reject });
    send({ id, type: "invoke", clip, command, input });
  });
}

// === IPC Server ===

export async function serveIPC(clip: Clip): Promise<void> {
  // Redirect console.log to stderr so stdout is reserved for IPC
  const origLog = console.log;
  console.log = (...args: unknown[]) => {
    process.stderr.write(args.map(String).join(" ") + "\n");
  };

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
        // Registration confirmed
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

      default:
        process.stderr.write(`[ipc] unknown message type: ${msg.type}\n`);
    }
  }
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
    const parsed = cmd.input.parse(msg.input ?? {});
    const output = await cmd.fn(parsed);
    send({ id: msg.id, type: "result", output });
  } catch (err) {
    send({ id: msg.id, type: "error", error: err instanceof Error ? err.message : String(err) });
  }
}

// === Line Reader ===

async function* createLineReader(stream: NodeJS.ReadableStream): AsyncGenerator<string> {
  let buffer = "";
  for await (const chunk of stream) {
    buffer += chunk.toString();
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (line.trim()) yield line;
    }
  }
  if (buffer.trim()) yield buffer;
}
