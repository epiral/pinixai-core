import {
  createHubClient,
  hubInvoke as _hubInvoke,
  type ClipInfo,
} from "@pinixai/hub-client";

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
  const client = createHubClient({
    baseUrl: hubUrl ?? process.env.PINIX_URL ?? "http://127.0.0.1:9000",
    token: authToken,
  });
  return _hubInvoke(client, clipName, command, input, clipToken);
}

/**
 * List all clips registered on the Hub.
 */
export async function hubListClips(
  hubUrl?: string,
  authToken?: string,
): Promise<ClipInfo[]> {
  const client = createHubClient({
    baseUrl: hubUrl ?? process.env.PINIX_URL ?? "http://127.0.0.1:9000",
    token: authToken,
  });
  const response = await client.listClips({});
  return response.clips;
}
