import { readFile } from "node:fs/promises";
import path from "node:path";
import { Script } from "node:vm";

const rootDir = process.cwd();
const widgetPath = path.join(rootDir, "mcp", "generated", "xhs-widget.html");
const widget = await readFile(widgetPath, "utf8");
const scripts = [...widget.matchAll(/<script>([\s\S]*?)<\/script>/g)];
if (scripts.length !== 1) throw new Error("Widget 必须包含一个完整的内联脚本。");
const distHtml = await readFile(path.join(rootDir, "web/dist/index.html"), "utf8");
const entry = distHtml.match(/<script\s+type="module"[^>]+src="([^"]+)"/);
if (!entry) throw new Error("缺少 Vue 构建入口。");
const entryJs = await readFile(path.join(rootDir, "web/dist", entry[1].replace(/^\.?\//, "")), "utf8");
if (!scripts[0][1].includes(entryJs.replaceAll("</script", "<\\/script"))) {
  throw new Error("Widget 内联过程改写了构建脚本内容。");
}
for (const [index, match] of scripts.entries()) {
  try {
    new Script(match[1], { filename: `xhs-widget-script-${index}.js` });
  } catch (error) {
    throw new Error(`Widget 内联脚本无法执行：${error.message}`);
  }
}

const requiredHandshakeMarkers = [
  "ui/initialize",
  "ui/notifications/initialized",
];

for (const marker of requiredHandshakeMarkers) {
  if (!widget.includes(marker)) {
    throw new Error(`Widget 缺少 MCP Apps Host 握手：${marker}`);
  }
}

console.log("OK: Widget 内联脚本语法有效，包含 MCP Apps Host 初始化握手。");
