import { z, type ZodError, type ZodObject, type ZodType } from "zod";
import { zodToManifestType } from "./manifest";

export class CLIHelpError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CLIHelpError";
  }
}

function unwrapSchema(schema: ZodType): ZodType {
  if (
    schema instanceof z.ZodOptional ||
    schema instanceof z.ZodNullable ||
    schema instanceof z.ZodDefault
  ) {
    return unwrapSchema(schema.unwrap() as ZodType);
  }

  return schema;
}

function getSchemaDescription(schema: ZodType): string | undefined {
  if (schema.description) {
    return schema.description;
  }

  if (
    schema instanceof z.ZodOptional ||
    schema instanceof z.ZodNullable ||
    schema instanceof z.ZodDefault
  ) {
    return getSchemaDescription(schema.unwrap() as ZodType);
  }

  return undefined;
}

function getDefaultValue(schema: ZodType): unknown {
  if (schema instanceof z.ZodDefault) {
    return (schema as ZodType & { _def: { defaultValue: unknown } })._def.defaultValue;
  }

  if (schema instanceof z.ZodOptional || schema instanceof z.ZodNullable) {
    return getDefaultValue(schema.unwrap() as ZodType);
  }

  return undefined;
}

function hasDefaultValue(schema: ZodType): boolean {
  if (schema instanceof z.ZodDefault) {
    return true;
  }

  if (schema instanceof z.ZodOptional || schema instanceof z.ZodNullable) {
    return hasDefaultValue(schema.unwrap() as ZodType);
  }

  return false;
}

function formatOptionType(schema: ZodType): string {
  if (schema instanceof z.ZodOptional || schema instanceof z.ZodDefault) {
    return formatOptionType(schema.unwrap() as ZodType);
  }

  return zodToManifestType(schema);
}

function formatZodError(error: ZodError): string {
  return error.issues
    .map((issue) => {
      const path = issue.path.length > 0 ? issue.path.join(".") : "input";
      return `${path}: ${issue.message}`;
    })
    .join("\n");
}

function parseBoolean(value: string): boolean {
  if (value === "true" || value === "1") {
    return true;
  }

  if (value === "false" || value === "0") {
    return false;
  }

  throw new Error(`Invalid boolean value: ${value}`);
}

function parseScalarValue(value: string, schema: ZodType): unknown {
  const normalized = unwrapSchema(schema);

  if (normalized instanceof z.ZodNumber) {
    const parsed = Number(value);

    if (Number.isNaN(parsed) || !Number.isFinite(parsed)) {
      throw new Error(`Invalid number value: ${value}`);
    }

    return parsed;
  }

  if (normalized instanceof z.ZodBoolean) {
    return parseBoolean(value);
  }

  if (normalized instanceof z.ZodLiteral) {
    const literalValues = Array.from((normalized as ZodType & { values: Set<unknown> }).values);
    const literalValue = literalValues[0];

    if (typeof literalValue === "number") {
      const parsed = Number(value);

      if (Number.isNaN(parsed) || !Number.isFinite(parsed)) {
        throw new Error(`Invalid number value: ${value}`);
      }

      return parsed;
    }

    if (typeof literalValue === "boolean") {
      return parseBoolean(value);
    }
  }

  return value;
}

export function formatCLIHelp(
  schema: ZodObject,
  commandName?: string,
  describe?: string,
): string {
  const lines: string[] = [];

  if (commandName) {
    lines.push(`Command: ${commandName}`);
  }

  if (describe) {
    lines.push(describe);
  }

  const entries = Object.entries(schema.shape);
  lines.push("Arguments:");

  if (entries.length === 0) {
    lines.push("  (none)");
  }

  for (const [key, value] of entries) {
    const flags: string[] = [value.isOptional() ? "optional" : "required"];

    if (hasDefaultValue(value)) {
      flags.push(`default: ${JSON.stringify(getDefaultValue(value))}`);
    }

    const description = getSchemaDescription(value);
    const suffix = description ? ` - ${description}` : "";
    lines.push(`  --${key}: ${formatOptionType(value)} (${flags.join(", ")})${suffix}`);
  }

  lines.push("  --help: boolean (optional) - Show command help");

  return lines.join("\n");
}

export function parseCLIArgs<T extends ZodObject>(args: string[], schema: T): z.infer<T> {
  if (args.includes("--help")) {
    throw new CLIHelpError(formatCLIHelp(schema));
  }

  const values: Record<string, unknown> = {};
  const shape = schema.shape as Record<string, ZodType>;
  let index = 0;

  while (index < args.length) {
    const arg = args[index];

    if (arg === undefined) {
      break;
    }

    if (!arg.startsWith("--")) {
      throw new Error(`Unexpected argument: ${arg}`);
    }

    const key = arg.slice(2);
    const field = shape[key];

    if (!field) {
      throw new Error(`Unknown option: --${key}`);
    }

    const normalized = unwrapSchema(field);
    const next = args[index + 1];

    if (normalized instanceof z.ZodBoolean && (next === undefined || next.startsWith("--"))) {
      values[key] = true;
      index += 1;
      continue;
    }

    if (next === undefined) {
      throw new Error(`Missing value for --${key}`);
    }

    if (normalized instanceof z.ZodRecord) {
      try {
        values[key] = JSON.parse(next);
      } catch {
        throw new Error(`Invalid JSON value for --${key}: ${next}`);
      }
    } else if (normalized instanceof z.ZodArray) {
      const current = values[key];
      const parsed = parseScalarValue(next, normalized.element as ZodType);

      if (Array.isArray(current)) {
        current.push(parsed);
      } else {
        values[key] = [parsed];
      }
    } else {
      values[key] = parseScalarValue(next, field);
    }

    index += 2;
  }

  const result = schema.safeParse(values);

  if (!result.success) {
    throw new Error(formatZodError(result.error));
  }

  return result.data;
}
