import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { Clip } from "./clip";

export async function serveMCP(clip: Clip): Promise<void> {
  const server = new McpServer({
    name: clip.name,
    version: "1.0.0",
  });

  for (const [name, commandHandler] of clip.getCommands()) {
    const description = clip.getCommandDescription(name);

    server.registerTool(
      name,
      {
        description,
        inputSchema: commandHandler.input,
      },
      async (input) => {
        const output = await commandHandler.fn(input);
        const parsedOutput = commandHandler.output.parse(output);

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(parsedOutput),
            },
          ],
        };
      },
    );
  }

  const transport = new StdioServerTransport();
  await server.connect(transport);
}
