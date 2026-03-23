import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { getClipName, type Clip } from "./clip";
import { redirectConsoleToStderr } from "./ipc";

export async function serveMCP(clip: Clip): Promise<void> {
  // Redirect console.log to stderr so stdout is reserved for MCP JSON-RPC
  redirectConsoleToStderr();
  const server = new McpServer({
    name: getClipName(clip) ?? clip.constructor.name,
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
