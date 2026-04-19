import { z, type ZodType } from "zod";

export interface Stream {
  chunk(data: unknown): void;
}

export interface HandlerDef<I extends ZodType = ZodType, O extends ZodType = ZodType> {
  input: I;
  output: O;
  fn: (input: z.infer<I>, stdin: string, stream?: Stream) => Promise<z.infer<O>>;
}

export function handler<I extends ZodType, O extends ZodType>(
  input: I,
  output: O,
  fn: (input: z.infer<I>, stdin: string, stream?: Stream) => Promise<z.infer<O>>,
): HandlerDef<I, O> {
  return {
    input,
    output,
    fn: async (raw: z.infer<I>, stdin: string, stream?: Stream) => {
      const parsed = await input.parseAsync(raw);
      return fn(parsed, stdin, stream);
    },
  };
}

// === Command Groups (sub-commands) ===

export interface SubcommandDef {
  description: string;
  handler: HandlerDef;
}

export interface GroupDef {
  __type: "group";
  description: string;
  commands: Record<string, SubcommandDef>;
}

export function isGroupDef(value: unknown): value is GroupDef {
  return (
    value !== null &&
    typeof value === "object" &&
    (value as GroupDef).__type === "group"
  );
}

export function commandGroup(
  description: string,
  commands: Record<string, [string, HandlerDef]>,
): GroupDef {
  const mapped: Record<string, SubcommandDef> = {};
  for (const [name, [desc, h]] of Object.entries(commands)) {
    mapped[name] = { description: desc, handler: h };
  }
  return { __type: "group", description, commands: mapped };
}
