import type { z } from "zod";
import type { Clip } from "./clip";

type IPCRequest = {
  id?: unknown;
  command?: unknown;
  input?: unknown;
};

type IPCResponse =
  | {
      id: unknown;
      output: unknown;
    }
  | {
      id: unknown;
      error: {
        message: string;
        code: string;
      };
    };

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function writeResponse(response: IPCResponse): void {
  process.stdout.write(`${JSON.stringify(response)}\n`);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}

function createErrorResponse(id: unknown, message: string, code: string): IPCResponse {
  return {
    id,
    error: {
      message,
      code,
    },
  };
}

async function handleRequestLine(clip: Clip, line: string): Promise<void> {
  let request: IPCRequest;

  try {
    request = JSON.parse(line) as IPCRequest;
  } catch (error) {
    writeResponse(createErrorResponse(null, `Invalid JSON: ${toErrorMessage(error)}`, "INVALID_JSON"));
    return;
  }

  const { id = null, command, input } = request;

  if (typeof command !== "string" || command.length === 0) {
    writeResponse(createErrorResponse(id, "Request command must be a non-empty string", "INVALID_REQUEST"));
    return;
  }

  const commandHandler = clip.getCommands().get(command);

  if (!commandHandler) {
    writeResponse(createErrorResponse(id, `Unknown command: ${command}`, "COMMAND_NOT_FOUND"));
    return;
  }

  if (!isObject(input)) {
    writeResponse(createErrorResponse(id, "Request input must be an object", "INVALID_INPUT"));
    return;
  }

  try {
    const parsedInput = await commandHandler.input.parseAsync(input) as z.infer<typeof commandHandler.input>;
    const output = await commandHandler.fn(parsedInput);
    const parsedOutput = await commandHandler.output.parseAsync(output);

    writeResponse({
      id,
      output: parsedOutput,
    });
  } catch (error) {
    writeResponse(createErrorResponse(id, toErrorMessage(error), "COMMAND_ERROR"));
  }
}

function redirectConsoleLogToStderr(): void {
  console.log = (...args: unknown[]) => {
    const serialized = args
      .map((arg) => {
        if (typeof arg === "string") {
          return arg;
        }

        try {
          return JSON.stringify(arg);
        } catch {
          return String(arg);
        }
      })
      .join(" ");

    process.stderr.write(`${serialized}\n`);
  };
}

export async function serveIPC(clip: Clip): Promise<void> {
  redirectConsoleLogToStderr();

  const reader = Bun.stdin.stream().getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();

      if (done) {
        break;
      }

      buffer += decoder.decode(value, { stream: true });

      while (true) {
        const newlineIndex = buffer.indexOf("\n");

        if (newlineIndex === -1) {
          break;
        }

        const line = buffer.slice(0, newlineIndex).trim();
        buffer = buffer.slice(newlineIndex + 1);

        if (line.length === 0) {
          continue;
        }

        try {
          await handleRequestLine(clip, line);
        } catch (error) {
          writeResponse(createErrorResponse(null, toErrorMessage(error), "INTERNAL_ERROR"));
        }
      }
    }

    buffer += decoder.decode();
    const tail = buffer.trim();

    if (tail.length > 0) {
      try {
        await handleRequestLine(clip, tail);
      } catch (error) {
        writeResponse(createErrorResponse(null, toErrorMessage(error), "INTERNAL_ERROR"));
      }
    }
  } finally {
    reader.releaseLock();
  }
}
