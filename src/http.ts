import { dirname, join, resolve, sep } from "node:path";
import { getClipName, type Clip } from "./clip";
import { zodToManifestType } from "./manifest";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function createHeaders(headers?: Headers | Record<string, string>): Headers {
  const result = new Headers(CORS_HEADERS);

  if (!headers) {
    return result;
  }

  const extraHeaders = new Headers(headers);

  for (const [key, value] of extraHeaders.entries()) {
    result.set(key, value);
  }

  return result;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: createHeaders({
      "Content-Type": "application/json; charset=utf-8",
    }),
  });
}

function textResponse(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: createHeaders({
      "Content-Type": "text/plain; charset=utf-8",
    }),
  });
}

function errorResponse(message: string, status: number): Response {
  return jsonResponse({ error: message }, status);
}

function resolveWithinRoot(root: string, relativePath: string): string | null {
  const candidate = resolve(root, relativePath);

  if (candidate === root || candidate.startsWith(`${root}${sep}`)) {
    return candidate;
  }

  return null;
}

function getStaticRoots(): string[] {
  const scriptDir = dirname(Bun.main);
  return [join(scriptDir, "web", "dist"), join(scriptDir, "web")];
}

function normalizeStaticPath(pathname: string): string {
  const decodedPathname = decodeURIComponent(pathname);
  const trimmedPathname = decodedPathname.replace(/^\/+/, "");

  if (trimmedPathname.length === 0) {
    return "index.html";
  }

  if (decodedPathname.endsWith("/")) {
    return join(trimmedPathname, "index.html");
  }

  return trimmedPathname;
}

async function findStaticFile(pathname: string): Promise<ReturnType<typeof Bun.file> | null> {
  const relativePath = normalizeStaticPath(pathname);

  for (const root of getStaticRoots()) {
    const candidatePath = resolveWithinRoot(root, relativePath);

    if (!candidatePath) {
      continue;
    }

    const file = Bun.file(candidatePath);

    if (await file.exists()) {
      return file;
    }
  }

  return null;
}

function fileResponse(file: ReturnType<typeof Bun.file>): Response {
  const headers = file.type
    ? createHeaders({ "Content-Type": file.type })
    : createHeaders();

  return new Response(file, { headers });
}

async function readJSONBody(request: Request): Promise<unknown> {
  const bodyText = await request.text();

  if (bodyText.trim().length === 0) {
    return {};
  }

  try {
    return JSON.parse(bodyText) as unknown;
  } catch (error) {
    throw new Error(`Invalid JSON: ${toErrorMessage(error)}`);
  }
}

function listCommands(clip: Clip): Response {
  const commands = Array.from(clip.getCommands().entries()).map(([name, commandHandler]) => ({
    name,
    description: clip.getCommandDescription(name) ?? null,
    method: "POST",
    path: `/api/${name}`,
    input: zodToManifestType(commandHandler.input),
    output: zodToManifestType(commandHandler.output),
  }));

  return jsonResponse({ commands });
}

async function handleCommandRequest(clip: Clip, commandName: string, request: Request): Promise<Response> {
  const commandHandler = clip.getCommands().get(commandName);

  if (!commandHandler) {
    return errorResponse(`Unknown command: ${commandName}`, 404);
  }

  let input: unknown;

  try {
    input = await readJSONBody(request);
  } catch (error) {
    return errorResponse(toErrorMessage(error), 400);
  }

  let parsedInput: unknown;

  try {
    parsedInput = await commandHandler.input.parseAsync(input);
  } catch (error) {
    return errorResponse(toErrorMessage(error), 400);
  }

  let output: unknown;

  try {
    output = await commandHandler.fn(parsedInput as never);
  } catch (error) {
    return errorResponse(toErrorMessage(error), 500);
  }

  try {
    const parsedOutput = await commandHandler.output.parseAsync(output);
    return jsonResponse(parsedOutput);
  } catch (error) {
    return errorResponse(toErrorMessage(error), 500);
  }
}

async function handleStaticRequest(pathname: string): Promise<Response> {
  const file = await findStaticFile(pathname);

  if (file) {
    return fileResponse(file);
  }

  const fallbackFile = await findStaticFile("/index.html");

  if (fallbackFile) {
    return fileResponse(fallbackFile);
  }

  return errorResponse(`Static file not found: ${pathname}`, 404);
}

async function handleRequest(clip: Clip, request: Request): Promise<Response> {
  const url = new URL(request.url);
  const pathname = url.pathname;
  const method = request.method.toUpperCase();

  if (method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: createHeaders(),
    });
  }

  if (pathname === "/manifest") {
    if (method !== "GET") {
      return errorResponse("Method not allowed", 405);
    }

    return textResponse(clip.toManifest());
  }

  if (pathname === "/api" || pathname === "/api/") {
    if (method !== "GET") {
      return errorResponse("Method not allowed", 405);
    }

    return listCommands(clip);
  }

  if (pathname.startsWith("/api/")) {
    if (method !== "POST") {
      return errorResponse("Method not allowed", 405);
    }

    const commandName = pathname.slice("/api/".length);

    if (commandName.length === 0 || commandName.includes("/")) {
      return errorResponse("Unknown command", 404);
    }

    return handleCommandRequest(clip, commandName, request);
  }

  if (method !== "GET" && method !== "HEAD") {
    return errorResponse("Method not allowed", 405);
  }

  try {
    return await handleStaticRequest(pathname);
  } catch (error) {
    return errorResponse(toErrorMessage(error), 500);
  }
}

export async function serveHTTP(clip: Clip, port = 3000): Promise<void> {
  const server = Bun.serve({
    port,
    fetch: (request) => handleRequest(clip, request),
  });

  console.error(`Clip "${getClipName(clip) ?? clip.constructor.name}" running at http://localhost:${server.port}`);
}
