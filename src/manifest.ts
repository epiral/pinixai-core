import { z, type ZodType } from "zod";
import type { Clip } from "./clip";

export interface IPCManifest {
  name: string;
  domain: string;
  commands: string[];
  dependencies: string[];
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
    return `${zodToManifestType(schema.unwrap())} (optional)`;
  }

  if (schema instanceof z.ZodDefault) {
    return `${zodToManifestType(schema.unwrap())} (default: ${formatLiteralValue(getDefaultValue(schema))})`;
  }

  if (schema instanceof z.ZodNullable) {
    return `${zodToManifestType(schema.unwrap())} | null`;
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
    return `Array<${zodToManifestType(schema.element)}>`;
  }

  if (schema instanceof z.ZodObject) {
    const entries = Object.entries(schema.shape);

    if (entries.length === 0) {
      return "{}";
    }

    return `{ ${entries
      .map(([key, value]) => `${key}${value.isOptional() ? "?" : ""}: ${zodToManifestType(value)}`)
      .join("; ")} }`;
  }

  if (schema instanceof z.ZodUnion) {
    return schema.options.map(zodToManifestType).join(" | ");
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
  const lines = [
    `Clip: ${clip.name}`,
    `Domain: ${clip.domain}`,
    "",
  ];

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

export function createIPCManifest(clip: Clip): IPCManifest {
  const dependencies = (clip as Clip & { dependencies?: unknown }).dependencies;

  return {
    name: clip.name,
    domain: clip.domain,
    commands: Array.from(clip.getCommands().keys()),
    dependencies: Array.isArray(dependencies)
      ? dependencies.filter((dependency): dependency is string => typeof dependency === "string")
      : [],
  };
}
