import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { z, type ZodType } from "zod";
import { getClipName, type Clip } from "./clip";

export interface IPCCommandInfo {
  name: string;
  description?: string;
  input?: string;
  output?: string;
}

export interface IPCManifest {
  domain: string;
  description?: string;
  commands: IPCCommandInfo[];
  dependencies: Record<string, { package: string; version: string }>;
  patterns?: string[];
  entities?: Record<string, unknown>;
  package?: string;
  version?: string;
}

function formatLiteralValue(value: unknown): string {
  return JSON.stringify(value);
}

function getDefaultValue(schema: ZodType): unknown {
  if (schema instanceof z.ZodDefault) {
    return (schema as ZodType & { _def: { defaultValue: unknown } })._def.defaultValue;
  }

  return undefined;
}

export function zodToManifestType(schema: ZodType): string {
  if (schema instanceof z.ZodOptional) {
    return `${zodToManifestType(schema.unwrap() as ZodType)} (optional)`;
  }

  if (schema instanceof z.ZodDefault) {
    return `${zodToManifestType(schema.unwrap() as ZodType)} (default: ${formatLiteralValue(getDefaultValue(schema))})`;
  }

  if (schema instanceof z.ZodNullable) {
    return `${zodToManifestType(schema.unwrap() as ZodType)} | null`;
  }

  if (schema instanceof z.ZodString) {
    return "string";
  }

  if (schema instanceof z.ZodNumber) {
    return "number";
  }

  if (schema instanceof z.ZodBoolean) {
    return "boolean";
  }

  if (schema instanceof z.ZodEnum) {
    return schema.options.map(formatLiteralValue).join(" | ");
  }

  if (schema instanceof z.ZodLiteral) {
    const literalValues = Array.from((schema as ZodType & { values: Set<unknown> }).values);
    return literalValues.map(formatLiteralValue).join(" | ");
  }

  if (schema instanceof z.ZodArray) {
    return `Array<${zodToManifestType(schema.element as ZodType)}>`;
  }

  if (schema instanceof z.ZodRecord) {
    const def = (schema as ZodType & { _zod?: { def?: { valueType?: ZodType } } })._zod?.def;
    if (def?.valueType) {
      return `Record<string, ${zodToManifestType(def.valueType)}>`;
    }
    return "Record<string, unknown>";
  }

  if (schema instanceof z.ZodObject) {
    const entries = Object.entries(schema.shape);

    if (entries.length === 0) {
      return "{}";
    }

    return `{ ${entries
      .map(([key, value]) => `${key}${(value as ZodType).isOptional() ? "?" : ""}: ${zodToManifestType(value as ZodType)}`)
      .join("; ")} }`;
  }

  if (schema instanceof z.ZodUnion) {
    return (schema.options as ZodType[]).map(zodToManifestType).join(" | ");
  }

  if (schema instanceof z.ZodNull) {
    return "null";
  }

  if (schema instanceof z.ZodUndefined) {
    return "undefined";
  }

  if (schema instanceof z.ZodAny) {
    return "any";
  }

  if (schema instanceof z.ZodUnknown) {
    return "unknown";
  }

  return schema.constructor.name.replace(/^Zod/, "").toLowerCase();
}

export function generateManifest(clip: Clip): string {
  const name = getClipName(clip);
  const lines = name ? [`Clip: ${name}`, `Domain: ${clip.domain}`, ""] : [`Domain: ${clip.domain}`, ""];

  if (clip.patterns.length > 0) {
    lines.push("Patterns:");
    for (const pattern of clip.patterns) {
      lines.push(`  ${pattern}`);
    }
    lines.push("");
  }

  const entityEntries = Object.entries(clip.entities);
  if (entityEntries.length > 0) {
    lines.push("Entities:");
    for (const [name, schema] of entityEntries) {
      const entityDesc = schema.description;
      lines.push(`  ${name}${entityDesc ? ` — ${entityDesc}` : ""}:`);
      for (const [field, fieldSchema] of Object.entries(schema.shape)) {
        const desc = (fieldSchema as z.ZodType).description;
        const type = zodToManifestType(fieldSchema as z.ZodType);
        lines.push(`    ${field}: ${type}${desc ? ` — ${desc}` : ""}`);
      }
    }
    lines.push("");
  }

  lines.push("Commands:");

  const commands = Array.from(clip.getCommands().entries());

  if (commands.length === 0) {
    lines.push("- none");
    return lines.join("\n");
  }

  for (const [name, handler] of commands) {
    lines.push(`- ${name}`);

    const describe = clip.getCommandDescription(name);
    if (describe) {
      lines.push(`  Description: ${describe}`);
    }

    lines.push(`  Input: ${zodToManifestType(handler.input)}`);
    lines.push(`  Output: ${zodToManifestType(handler.output)}`);
  }

  return lines.join("\n");
}

function findJsonFile(filename: string): Record<string, unknown> | null {
  let dir = dirname(Bun.main);
  for (;;) {
    const filePath = join(dir, filename);
    if (existsSync(filePath)) {
      try {
        return JSON.parse(readFileSync(filePath, "utf8")) as Record<string, unknown>;
      } catch {
        return null;
      }
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

function resolvePackageInfo(): { package?: string; version?: string } {
  const clipJson = findJsonFile("clip.json");
  const packageJson = findJsonFile("package.json");

  return {
    package: asString(clipJson?.name) ?? asString(packageJson?.name),
    version: asString(clipJson?.version) ?? asString(packageJson?.version),
  };
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

export function createIPCManifest(clip: Clip): IPCManifest {
  const pkgInfo = resolvePackageInfo();

  const commands: IPCCommandInfo[] = [];

  for (const [name, handler] of clip.getCommands()) {
    const description = clip.getCommandDescription(name);
    const cmd: IPCCommandInfo = { name };
    if (description) cmd.description = description;

    try {
      cmd.input = JSON.stringify(z.toJSONSchema(handler.input));
    } catch {}
    try {
      cmd.output = JSON.stringify(z.toJSONSchema(handler.output));
    } catch {}

    commands.push(cmd);
  }

  const manifest: IPCManifest = {
    domain: clip.domain,
    commands,
    dependencies: clip.dependencies,
    ...pkgInfo,
  };

  if (clip.patterns.length > 0) {
    manifest.patterns = clip.patterns;
  }

  const entityEntries = Object.entries(clip.entities);
  if (entityEntries.length > 0) {
    const entities: Record<string, unknown> = {};
    for (const [name, schema] of entityEntries) {
      try {
        entities[name] = z.toJSONSchema(schema);
      } catch {}
    }
    if (Object.keys(entities).length > 0) {
      manifest.entities = entities;
    }
  }

  return manifest;
}
