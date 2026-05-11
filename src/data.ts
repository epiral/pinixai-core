export interface DataEntry {
  name: string;
  path: string;
  type: "file" | "directory";
  size: number;
  mime?: string;
}

export interface DataStat {
  size: number;
  mime?: string;
  modified: string;
}

interface DataResultMessage {
  uri?: string;
  content?: string;
  entries?: DataEntry[];
  stat?: DataStat;
  error?: { code: string; message: string };
}

export interface ClipData {
  write(path: string, content: Buffer | string, opts?: { mime?: string }): Promise<string>;
  read(path: string): Promise<Buffer>;
  list(path?: string): Promise<DataEntry[]>;
  delete(path: string): Promise<void>;
  stat(path: string): Promise<DataStat | null>;
  uri(path: string): string;
  resolve(uri: string): Promise<Buffer>;
}

import { dataRequest, getAlias } from "./ipc";

export const data: ClipData = {
  async write(path: string, content: Buffer | string, opts?: { mime?: string }): Promise<string> {
    const encoded = typeof content === "string"
      ? Buffer.from(content).toString("base64")
      : content.toString("base64");
    const result = await dataRequest("write", path, encoded, opts?.mime) as DataResultMessage;
    if (result.error) throw new Error(result.error.message);
    return result.uri!;
  },

  async read(path: string): Promise<Buffer> {
    const result = await dataRequest("read", path) as DataResultMessage;
    if (result.error) throw new Error(result.error.message);
    return Buffer.from(result.content ?? "", "base64");
  },

  async list(path?: string): Promise<DataEntry[]> {
    const result = await dataRequest("list", path ?? "") as DataResultMessage;
    if (result.error) throw new Error(result.error.message);
    return result.entries ?? [];
  },

  async delete(path: string): Promise<void> {
    const result = await dataRequest("delete", path) as DataResultMessage;
    if (result.error) throw new Error(result.error.message);
  },

  async stat(path: string): Promise<DataStat | null> {
    const result = await dataRequest("stat", path) as DataResultMessage;
    if (result.error) {
      if (result.error.code === "not_found") return null;
      throw new Error(result.error.message);
    }
    return result.stat ?? null;
  },

  uri(path: string): string {
    const alias = getAlias();
    if (!alias) throw new Error("Clip not registered yet — uri() is only available after IPC registration");
    return `pinix://${alias}/${path}`;
  },

  async resolve(uri: string): Promise<Buffer> {
    if (uri.startsWith("https://") || uri.startsWith("http://")) {
      const resp = await fetch(uri);
      if (!resp.ok) throw new Error(`fetch ${uri}: ${resp.status}`);
      return Buffer.from(await resp.arrayBuffer());
    }

    if (uri.startsWith("pinix://")) {
      const withoutScheme = uri.slice("pinix://".length);
      const slashIdx = withoutScheme.indexOf("/");
      if (slashIdx < 0) throw new Error(`Invalid pinix URI: ${uri}`);
      const clipName = withoutScheme.slice(0, slashIdx);
      const filePath = withoutScheme.slice(slashIdx + 1);
      const result = await dataRequest("read", filePath, undefined, undefined, clipName) as DataResultMessage;
      if (result.error) throw new Error(result.error.message);
      return Buffer.from(result.content ?? "", "base64");
    }

    throw new Error(`Unsupported URI scheme: ${uri}. Use pinix:// or https://`);
  },
};
