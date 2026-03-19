import { Clip, command, handler, z } from "../src/index.ts";

const todoSchema = z.object({
  id: z.number().describe("唯一标识"),
  title: z.string().describe("待办标题"),
}).describe("待办事项，最小任务单元");

class TodoClip extends Clip {
  name = "todo";
  domain = "productivity";
  patterns = [
    "list → add → list (添加后验证)",
    "list → delete → list (删除后验证)",
  ];

  entities = {
    Todo: todoSchema,
  };

  todos = [
    { id: 1, title: "学习 Bun" },
    { id: 2, title: "整理今天的任务" },
  ];

  nextId = this.todos.length + 1;

  @command("List all todos")
  list = handler(
    z.object({}),
    z.object({
      todos: z.array(todoSchema),
    }),
    async () => ({
      todos: this.todos,
    }),
  );

  @command("Add a todo")
  add = handler(
    z.object({
      title: z.string().describe("Todo 标题"),
    }),
    z.object({
      todo: todoSchema,
    }),
    async ({ title }) => {
      const todo = {
        id: this.nextId,
        title,
      };

      this.nextId += 1;
      this.todos.push(todo);

      return { todo };
    },
  );

  @command("Delete a todo")
  delete = handler(
    z.object({
      id: z.number().describe("Todo ID"),
    }),
    z.object({
      success: z.boolean(),
      deletedId: z.number().nullable(),
    }),
    async ({ id }) => {
      const index = this.todos.findIndex((todo) => todo.id === id);

      if (index === -1) {
        return {
          success: false,
          deletedId: null,
        };
      }

      this.todos.splice(index, 1);

      return {
        success: true,
        deletedId: id,
      };
    },
  );
}

if (import.meta.main) {
  await new TodoClip().start();
}
