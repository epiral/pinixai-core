import { z } from "zod";
import { CLIHelpError, formatCLIHelp, parseCLIArgs } from "./cli";
import type { HandlerDef } from "./handler";
import { generateManifest } from "./manifest";

function isHandlerDef(value: unknown): value is HandlerDef {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<HandlerDef>;
  return (
    candidate.input instanceof z.ZodType &&
    candidate.output instanceof z.ZodType &&
    typeof candidate.fn === "function"
  );
}

export abstract class Clip {
  abstract name: string;
  abstract domain: string;
  abstract patterns: string[];

  protected readonly commands = new Map<string, HandlerDef>();
  protected readonly commandDescriptions = new Map<string, string>();

  async start(): Promise<void> {
    const args = process.argv.slice(2);
    const [modeOrCommand, ...restArgs] = args;

    if (!modeOrCommand || modeOrCommand === "--help") {
      console.log(this.printHelp());
      return;
    }

    if (modeOrCommand === "--mcp") {
      console.log("MCP mode not implemented yet");
      return;
    }

    if (modeOrCommand === "--ipc") {
      console.log("IPC mode not implemented yet");
      return;
    }

    if (modeOrCommand === "--manifest") {
      console.log(this.toManifest());
      return;
    }

    const commandName = modeOrCommand;
    const commandHandler = this.commands.get(commandName);

    if (!commandHandler) {
      console.error(`Unknown command: ${commandName}`);
      console.log(this.printHelp());
      return;
    }

    if (!(commandHandler.input instanceof z.ZodObject)) {
      console.error(`CLI mode only supports object input schemas for command: ${commandName}`);
      return;
    }

    try {
      const input = parseCLIArgs(restArgs, commandHandler.input);
      const output = await commandHandler.fn(input);
      const parsedOutput = commandHandler.output.parse(output);
      console.log(JSON.stringify(parsedOutput));
    } catch (error) {
      if (error instanceof CLIHelpError) {
        console.log(this.printCommandHelp(commandName, commandHandler));
        return;
      }

      console.error(error instanceof Error ? error.message : String(error));
    }
  }

  toManifest(): string {
    return generateManifest(this);
  }

  printHelp(): string {
    const lines = [
      `${this.name} (${this.domain})`,
      `Patterns: ${this.patterns.length > 0 ? this.patterns.join(", ") : "none"}`,
      "",
      "Usage:",
      "  bun run <script> <command> [options]",
      "  bun run <script> --help",
      "  bun run <script> --manifest",
      "  bun run <script> --mcp",
      "  bun run <script> --ipc",
      "",
      "Commands:",
    ];

    if (this.commands.size === 0) {
      lines.push("  (none)");
      return lines.join("\n");
    }

    for (const [commandName, commandHandler] of this.commands) {
      const describe = this.commandDescriptions.get(commandName);
      lines.push(`  ${commandName}${describe ? ` - ${describe}` : ""}`);

      if (commandHandler.input instanceof z.ZodObject) {
        const commandHelp = formatCLIHelp(commandHandler.input);
        lines.push(...commandHelp.split("\n").map((line) => `    ${line}`));
      } else {
        lines.push(`    Input: ${commandHandler.input.constructor.name}`);
      }
    }

    return lines.join("\n");
  }

  getCommands(): ReadonlyMap<string, HandlerDef> {
    return this.commands;
  }

  getCommandDescription(name: string): string | undefined {
    return this.commandDescriptions.get(name);
  }

  protected printCommandHelp(commandName: string, commandHandler: HandlerDef): string {
    const describe = this.commandDescriptions.get(commandName);

    if (!(commandHandler.input instanceof z.ZodObject)) {
      return [
        `Command: ${commandName}`,
        describe,
        `Input: ${commandHandler.input.constructor.name}`,
      ]
        .filter(Boolean)
        .join("\n");
    }

    return formatCLIHelp(commandHandler.input, commandName, describe);
  }

  static _registerCommand(target: object, propertyKey: string, describe?: string): void {
    if (!(target instanceof Clip)) {
      throw new Error("@command can only be used on Clip instances");
    }

    const clip = target as Clip;
    const value = (clip as Record<string, unknown>)[propertyKey];

    if (!isHandlerDef(value)) {
      throw new Error(`@command can only decorate handler() fields: ${propertyKey}`);
    }

    clip.commands.set(propertyKey, value);

    if (describe) {
      clip.commandDescriptions.set(propertyKey, describe);
    }
  }
}
