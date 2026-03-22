import { z, type ZodType } from "zod";

export interface Stream {
  chunk(data: unknown): void;
}

export interface HandlerDef<I extends ZodType = ZodType, O extends ZodType = ZodType> {
  input: I;
  output: O;
  fn: (input: z.infer<I>, stream?: Stream) => Promise<z.infer<O>>;
}

export function handler<I extends ZodType, O extends ZodType>(
  input: I,
  output: O,
  fn: (input: z.infer<I>, stream?: Stream) => Promise<z.infer<O>>,
): HandlerDef<I, O> {
  return { input, output, fn };
}
