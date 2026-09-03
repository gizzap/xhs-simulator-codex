import { readFile } from "node:fs/promises";
import path from "node:path";

const rootDir = process.cwd();
const widgetPath = path.join(rootDir, "mcp", "generated", "xhs-widget.html");
const widget = await readFile(widgetPath, "utf8");

const requiredHandshakeMarkers = [
  "ui/initialize",
  "ui/notifications/initialized",
];

for (const marker of requiredHandshakeMarkers) {
  if (!widget.includes(marker)) {
    throw new Error(`Widget 缺少 MCP Apps Host 握手：${marker}`);
  }
}

console.log("OK: Widget 包含 MCP Apps Host 初始化握手。");
