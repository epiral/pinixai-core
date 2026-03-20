import { Clip, command, handler, z } from "../src/index.ts";
import { browser } from "../packages/browser/src/index.ts";

class BrowserTestClip extends Clip {
  name = "browser-test";
  domain = "浏览器能力测试";
  dependencies = ["browser"];
  patterns = ["navigate -> evaluate (打开页面获取信息)"];
  override entities = {};

  @command("获取页面标题")
  getTitle = handler(
    z.object({
      url: z.string().describe("页面 URL"),
    }),
    z.object({
      title: z.string(),
      url: z.string(),
    }),
    async ({ url }) => {
      const nav = await browser.navigate({ url });
      const result = await browser.evaluate({ js: "document.title" });

      return {
        title: result.result as string,
        url: nav.url,
      };
    },
  );
}

if (import.meta.main) {
  await new BrowserTestClip().start();
}
