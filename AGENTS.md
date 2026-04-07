# AGENTS.md — @pinixai/core

@pinixai/core 是 Clip 开发 SDK。一次定义，多种运行模式（CLI / MCP / IPC / Web）。

## Source of Truth

| 主题 | 位置 |
|---|---|
| SDK API | `src/index.ts`（所有公开导出） |
| Clip 开发指南 | `repos/pinix/docs/clip-development.md` |
| IPC 协议 | `repos/pinix/docs/protocol.md` |
| 领域模型 | `epiral/dev/domain.md`（跨 repo） |

## 仓库结构

```
src/
├── index.ts       # 公开 API barrel
├── clip.ts        # 抽象 Clip 基类 + .start() 多模式入口
├── command.ts     # @command 装饰器
├── handler.ts     # handler() 工厂 + Stream 接口
├── ipc.ts         # IPC 协议：serveIPC + invoke/invokeClip/listClips
├── http.ts        # Web 模式：REST + SSE (Bun HTTP)
├── mcp.ts         # MCP 模式：stdio JSON-RPC
├── hub.ts         # Hub 集成：Connect-RPC invoke/listClips
├── web.ts         # 浏览器客户端（Clip Web UI 用）
├── manifest.ts    # Manifest 生成（text + IPC JSON Schema）
├── bindings.ts    # Binding 类型定义
└── cli.ts         # CLI 参数解析 + help 格式化
```

## 编译与运行

```bash
bun install

# 没有 build 步骤 — Bun 直接运行 .ts
# 开发 Clip 时：
bun run my-clip/index.ts           # CLI 模式
bun run my-clip/index.ts --ipc     # IPC 模式（pinixd 管理）
bun run my-clip/index.ts --mcp     # MCP 模式
bun run my-clip/index.ts --web 3000 # Web 模式
```

## 运行模式

Clip `.start()` 根据参数自动选择模式：

| 参数 | 模式 | 协议 | 用途 |
|---|---|---|---|
| `<command> --args` | CLI | stdin/stdout | 直接调用 |
| `--ipc` | IPC | NDJSON stdio | pinixd 管理 |
| `--mcp` | MCP | JSON-RPC stdio | AI Agent 调用 |
| `--web [port]` | Web | REST + SSE | 独立 Web UI |
| `--manifest` | Manifest | stdout | 输出 JSON Schema |
| `--help` | Help | stdout | 帮助信息 |

## Clip 开发模式

```typescript
import { Clip, command, handler, z } from "@pinixai/core";

class MyClip extends Clip {
  name = "my-clip";
  domain = "描述这个 Clip 的领域";
  patterns = ["典型使用场景"];

  @command("命令描述")
  myCommand = handler(
    z.object({ input: z.string() }),   // 输入 schema
    z.object({ output: z.string() }),  // 输出 schema
    async ({ input }) => {
      return { output: `processed: ${input}` };
    },
  );
}

if (import.meta.main) {
  await new MyClip().start();
}
```

## Clip 间调用

```typescript
// 通过 slot（需要 binding）
import { invoke } from "@pinixai/core";
const result = await invoke("browser", "evaluate", { code: "..." });

// 通过 alias（直接）
import { invokeClip } from "@pinixai/core";
const result = await invokeClip("todo-0ed1", "list", {});
```

路由优先级（在 pinixd 内）：Local Registry → Provider → Hub。

## Web UI 客户端

Clip 的 `web/` 目录可以放前端代码，通过 `@pinixai/core/web` 调用后端：

```typescript
import { invoke, invokeStream } from "@pinixai/core/web";

// 单次调用
const result = await invoke("list", { args: {} });

// 流式调用
invokeStream("chat", { args: { message: "hello" } },
  (event) => console.log(event),
  () => console.log("done"),
);
```

## 代码规范

- 运行时是 **Bun**，不是 Node.js
- Schema 用 **Zod v4**，不要手写 JSON Schema
- handler 的 input/output 必须有 Zod schema（用于 manifest 和类型推导）
- `console.error` 输出会被 pinixd 捕获到 `~/.pinix/logs/<alias>.log`
- `console.log` 在 IPC 模式下不要用（stdout 是 IPC 通道）
