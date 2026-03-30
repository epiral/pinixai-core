import { createClient, type Interceptor } from "@connectrpc/connect";
import { createConnectTransport } from "@connectrpc/connect-web";
import { HubService, type ClipInfo } from "./gen/hub_pb";

function authInterceptor(token: string): Interceptor {
  return (next) => (req) => {
    req.header.set("Authorization", `Bearer ${token}`);
    return next(req);
  };
}

function getTransport(hubUrl?: string, authToken?: string) {
  return createConnectTransport({
    baseUrl: hubUrl ?? process.env.PINIX_URL ?? "http://127.0.0.1:9000",
    interceptors: authToken ? [authInterceptor(authToken)] : [],
  });
}

function getClient(hubUrl?: string, authToken?: string) {
  return createClient(HubService, getTransport(hubUrl, authToken));
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/**
 * Invoke a command on a remote clip via Hub's Connect-RPC Invoke RPC.
 * The Invoke RPC is server-streaming: we collect all output chunks and return the aggregated result.
 */
export async function hubInvoke(
  clipName: string,
  command: string,
  input: unknown,
  clipToken?: string,
  hubUrl?: string,
  authToken?: string,
): Promise<unknown> {
  const client = getClient(hubUrl, authToken);
  const inputBytes = encoder.encode(JSON.stringify(input));

  let outputBytes = new Uint8Array(0);

  for await (const response of client.invoke({
    clipName,
    command,
    input: inputBytes,
    clipToken: clipToken ?? "",
  })) {
    if (response.error) {
      throw new Error(response.error.message || response.error.code || "Hub invoke error");
    }

    if (response.output.length > 0) {
      // Aggregate output chunks
      const merged = new Uint8Array(outputBytes.length + response.output.length);
      merged.set(outputBytes);
      merged.set(response.output, outputBytes.length);
      outputBytes = merged;
    }
  }

  if (outputBytes.length === 0) {
    return undefined;
  }

  const outputJson = decoder.decode(outputBytes);
  return JSON.parse(outputJson) as unknown;
}

/**
 * List all clips registered on the Hub.
 */
export async function hubListClips(hubUrl?: string, authToken?: string): Promise<ClipInfo[]> {
  const client = getClient(hubUrl, authToken);
  const response = await client.listClips({});
  return response.clips;
}
