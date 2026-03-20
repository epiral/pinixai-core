import { Clip, command, handler, z } from "../../src/index.ts";
import { browser } from "../../packages/browser/src/index.ts";

const NoteSchema = z.object({
  id: z.string().describe("笔记 ID"),
  title: z.string().describe("笔记标题"),
  author: z.string().describe("作者昵称"),
  likes: z.number().describe("点赞数"),
  preview: z.string().describe("预览文字"),
}).describe("小红书笔记");

const UserSchema = z.object({
  id: z.string().describe("用户 ID"),
  nickname: z.string().describe("昵称"),
  avatar: z.string().describe("头像 URL"),
}).describe("小红书用户");

export class XhsSearchClip extends Clip {
  name = "xhs-search";
  domain = "小红书搜索";
  dependencies = ["browser"];

  override entities = {
    Note: NoteSchema,
    User: UserSchema,
  };

  patterns = [
    "search -> note (搜索后查看详情)",
    "search -> user (搜索后查看作者)",
  ];

  @command("搜索笔记")
  search = handler(
    z.object({
      query: z.string().describe("搜索关键词"),
      limit: z.number().optional().describe("返回数量限制"),
    }),
    z.object({
      notes: z.array(NoteSchema),
    }),
    async ({ query, limit }) => {
      const maxResults = limit ?? 10;

      await browser.navigate({
        url: `https://www.xiaohongshu.com/search_result?keyword=${encodeURIComponent(query)}`,
        waitUntil: "networkidle",
      });

      await browser.waitForSelector({
        selector: ".note-item",
        timeout: 10000,
      });

      const result = await browser.evaluate({
        js: `
          (() => {
            const items = document.querySelectorAll('.note-item');
            const notes = [];

            for (let i = 0; i < Math.min(items.length, ${maxResults}); i++) {
              const item = items[i];
              const titleEl = item.querySelector('.title');
              const authorEl = item.querySelector('.author-name');
              const likesEl = item.querySelector('.like-count');
              const previewEl = item.querySelector('.desc');

              notes.push({
                id: item.getAttribute('data-id') || String(i),
                title: titleEl?.textContent?.trim() || '',
                author: authorEl?.textContent?.trim() || '',
                likes: parseInt(likesEl?.textContent?.replace(/[^0-9]/g, '') || '0', 10),
                preview: previewEl?.textContent?.trim() || '',
              });
            }

            return JSON.stringify(notes);
          })()
        `,
      });

      const notes = JSON.parse(result.result as string);
      return { notes };
    },
  );

  @command("获取笔记详情")
  note = handler(
    z.object({
      url: z.string().describe("笔记 URL"),
    }),
    z.object({
      title: z.string(),
      content: z.string(),
      author: UserSchema,
      likes: z.number(),
      collects: z.number(),
      comments: z.number(),
      images: z.array(z.string()),
    }),
    async ({ url }) => {
      await browser.navigate({ url, waitUntil: "networkidle" });
      await browser.waitForSelector({
        selector: ".note-detail",
        timeout: 10000,
      });

      const result = await browser.evaluate({
        js: `
          (() => {
            const title = document.querySelector('.title')?.textContent?.trim() || '';
            const content = document.querySelector('.content')?.textContent?.trim() || '';
            const authorName = document.querySelector('.author-name')?.textContent?.trim() || '';
            const authorId = document.querySelector('.author-link')?.getAttribute('href')?.split('/').pop() || '';
            const avatar = document.querySelector('.author-avatar img')?.src || '';
            const likes = parseInt(document.querySelector('.like-count')?.textContent?.replace(/[^0-9]/g, '') || '0', 10);
            const collects = parseInt(document.querySelector('.collect-count')?.textContent?.replace(/[^0-9]/g, '') || '0', 10);
            const comments = parseInt(document.querySelector('.comment-count')?.textContent?.replace(/[^0-9]/g, '') || '0', 10);
            const images = Array.from(document.querySelectorAll('.slide-item img')).map((img) => img.src);

            return JSON.stringify({
              title,
              content,
              author: {
                id: authorId,
                nickname: authorName,
                avatar,
              },
              likes,
              collects,
              comments,
              images,
            });
          })()
        `,
      });

      return JSON.parse(result.result as string);
    },
  );
}

if (import.meta.main) {
  await new XhsSearchClip().start();
}
