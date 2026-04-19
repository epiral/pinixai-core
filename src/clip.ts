import { z } from "zod";
import { CLIHelpError, formatCLIHelp, parseCLIArgs } from "./cli";
import type { HandlerDef } from "./handler";
import { isGroupDef } from "./handler";
import { serveHTTP } from "./http";
import { serveIPC } from "./ipc";
import { serveMCP } from "./mcp";
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
  abstract domain: string;
  abstract patterns: string[];
  dependencies: Record<string, { package: string; version: string }> = {};
  entities: Record<string, z.ZodObject<any>> = {};

  /**
   * How long (ms) the process stays alive after the last invoke completes.
   * - `30_000` (default): exit after 30s idle
   * - `0`: exit immediately after each invoke
   * - `Infinity`: never exit (persistent)
   */
  idleTimeout: number = 30_000;

  protected readonly commands = new Map<string, HandlerDef>();
  protected readonly commandDescriptions = new Map<string, string>();
  protected readonly commandGroups = new Map<string, string>();

  async start(): Promise<void> {
    const args = process.argv.slice(2);
    const [modeOrCommand, ...restArgs] = args;

    if (!modeOrCommand || modeOrCommand === "--help") {
      console.log(this.printHelp());
      return;
    }

    if (modeOrCommand === "--mcp") {
      return serveMCP(this);
    }

    if (modeOrCommand === "--ipc") {
      return serveIPC(this);
    }

    if (modeOrCommand === "--web") {
      const portArg = restArgs[0];

      if (portArg === undefined) {
        return serveHTTP(this);
      }

      const port = Number(portArg);

      if (Number.isNaN(port) || !Number.isFinite(port) || port !== Math.floor(port) || port < 0) {
        console.error(`Invalid port: ${portArg}`);
        return;
      }

      return serveHTTP(this, port);
    }

    if (modeOrCommand === "--manifest") {
      console.log(this.toManifest());
      return;
    }

    // Resolve command: collect non-flag tokens as command path, greedy match longest
    const { commandName, commandArgs } = this.resolveCommand(args);

    if (!commandName) {
      // Check if first token is a group name → show group help
      if (this.commandGroups.has(modeOrCommand)) {
        console.log(this.printGroupHelp(modeOrCommand));
        return;
      }
      console.error(`Unknown command: ${modeOrCommand}`);
      console.log(this.printHelp());
      return;
    }

    const commandHandler = this.commands.get(commandName)!;

    if (!(commandHandler.input instanceof z.ZodObject)) {
      console.error(`CLI mode only supports object input schemas for command: ${commandName}`);
      return;
    }

    try {
      const input = parseCLIArgs(commandArgs, commandHandler.input);
      const output = await commandHandler.fn(input, "");
      let parsedOutput: unknown;
      try {
        parsedOutput = commandHandler.output.parse(output);
      } catch {
        parsedOutput = output;
      }
      console.log(JSON.stringify(parsedOutput));
    } catch (error) {
      if (error instanceof CLIHelpError) {
        console.log(this.printCommandHelp(commandName, commandHandler));
        return;
      }

      console.error(error instanceof Error ? error.message : String(error));
    }
  }

  private resolveCommand(args: string[]): { commandName: string | null; commandArgs: string[] } {
    // Collect non-flag tokens as potential command path
    const cmdParts: string[] = [];
    let flagStart = args.length;

    for (let i = 0; i < args.length; i++) {
      const arg = args[i]!;
      if (arg.startsWith("-")) {
        flagStart = i;
        break;
      }
      cmdParts.push(arg);
    }

    const remainingArgs = args.slice(flagStart);

    // Greedy: try longest match first
    for (let len = cmdParts.length; len > 0; len--) {
      const candidate = cmdParts.slice(0, len).join(" ");
      if (this.commands.has(candidate)) {
        // Unused command tokens become part of args (shouldn't happen with one-level nesting)
        const extra = cmdParts.slice(len);
        return { commandName: candidate, commandArgs: [...extra, ...remainingArgs] };
      }
    }

    // Check if it's "group --help"
    if (cmdParts.length > 0 && this.commandGroups.has(cmdParts[0]!) && remainingArgs.includes("--help")) {
      return { commandName: null, commandArgs: [] };
    }

    return { commandName: null, commandArgs: [] };
  }

  toManifest(): string {
    return generateManifest(this);
  }

  printHelp(): string {
    const name = getClipName(this);
    const lines: string[] = [
      name ? `${name} (${this.domain})` : this.domain,
      "",
    ];

    if (this.patterns.length > 0) {
      lines.push("Patterns:");
      for (const pattern of this.patterns) {
        lines.push(`  ${pattern}`);
      }
      lines.push("");
    }

    lines.push("Usage:");
    lines.push("  bun run <script> <command> [options]");
    lines.push("  bun run <script> --help");
    lines.push("  bun run <script> --manifest");
    lines.push("  bun run <script> --mcp");
    lines.push("  bun run <script> --ipc");
    lines.push("  bun run <script> --web [port]");
    lines.push("");
    lines.push("Commands:");

    if (this.commands.size === 0) {
      lines.push("  (none)");
      return lines.join("\n");
    }

    // Separate top-level commands from grouped commands
    const groupedCommands = new Set<string>();
    for (const groupName of this.commandGroups.keys()) {
      for (const cmdName of this.commands.keys()) {
        if (cmdName.startsWith(`${groupName} `)) {
          groupedCommands.add(cmdName);
        }
      }
    }

    // Print top-level commands first
    for (const [commandName, commandHandler] of this.commands) {
      if (groupedCommands.has(commandName)) continue;

      const describe = this.commandDescriptions.get(commandName);
      lines.push(`  ${commandName}${describe ? ` - ${describe}` : ""}`);

      if (commandHandler.input instanceof z.ZodObject) {
        const commandHelp = formatCLIHelp(commandHandler.input);
        lines.push(...commandHelp.split("\n").map((line) => `    ${line}`));
      } else {
        lines.push(`    Input: ${commandHandler.input.constructor.name}`);
      }
    }

    // Print groups with sub-commands
    for (const [groupName, groupDesc] of this.commandGroups) {
      lines.push(`  ${groupName} - ${groupDesc}`);
      for (const [commandName, commandHandler] of this.commands) {
        if (!commandName.startsWith(`${groupName} `)) continue;
        const subName = commandName.slice(groupName.length + 1);
        const describe = this.commandDescriptions.get(commandName);
        lines.push(`    ${subName}${describe ? ` - ${describe}` : ""}`);

        if (commandHandler.input instanceof z.ZodObject) {
          const commandHelp = formatCLIHelp(commandHandler.input);
          lines.push(...commandHelp.split("\n").map((line) => `      ${line}`));
        }
      }
    }

    return lines.join("\n");
  }

  private printGroupHelp(groupName: string): string {
    const groupDesc = this.commandGroups.get(groupName);
    const lines: string[] = [
      `${groupName}${groupDesc ? ` - ${groupDesc}` : ""}`,
      "",
      "Sub-commands:",
    ];

    for (const [commandName, commandHandler] of this.commands) {
      if (!commandName.startsWith(`${groupName} `)) continue;
      const subName = commandName.slice(groupName.length + 1);
      const describe = this.commandDescriptions.get(commandName);
      lines.push(`  ${subName}${describe ? ` - ${describe}` : ""}`);

      if (commandHandler.input instanceof z.ZodObject) {
        const commandHelp = formatCLIHelp(commandHandler.input);
        lines.push(...commandHelp.split("\n").map((line) => `    ${line}`));
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

  getCommandGroups(): ReadonlyMap<string, string> {
    return this.commandGroups;
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
    const value = (clip as unknown as Record<string, unknown>)[propertyKey];

    if (isGroupDef(value)) {
      clip.commandGroups.set(propertyKey, value.description);
      for (const [subName, sub] of Object.entries(value.commands)) {
        const fullName = `${propertyKey} ${subName}`;
        clip.commands.set(fullName, sub.handler);
        clip.commandDescriptions.set(fullName, sub.description);
      }
      return;
    }

    if (!isHandlerDef(value)) {
      throw new Error(`@command can only decorate handler() or commandGroup() fields: ${propertyKey}`);
    }

    clip.commands.set(propertyKey, value);

    if (describe) {
      clip.commandDescriptions.set(propertyKey, describe);
    }
  }
}

export function getClipName(clip: Clip): string | undefined {
  const value = (clip as { name?: unknown }).name;
  return typeof value === "string" && value.length > 0 ? value : undefined;
}
