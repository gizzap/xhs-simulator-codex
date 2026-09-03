import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const GENERATED_DIR = path.join(ROOT_DIR, "mcp", "generated");
const SERVER_PATH = path.join(GENERATED_DIR, "xhs-mcp.mjs");
const WIDGET_PATH = path.join(GENERATED_DIR, "xhs-widget.html");
const RELEASE_PATH = path.join(GENERATED_DIR, "release-manifest.json");

for (const artifact of [SERVER_PATH, WIDGET_PATH, RELEASE_PATH]) {
  if (!existsSync(artifact)) {
    throw new Error(`缺少插件构建产物：${artifact}。请先运行 npm run build。`);
  }
}

const packageVersion = JSON.parse(readFileSync(path.join(ROOT_DIR, "package.json"), "utf8")).version;
const releaseVersion = JSON.parse(readFileSync(RELEASE_PATH, "utf8")).version;
if (packageVersion !== releaseVersion) {
  throw new Error(`插件源码版本为 ${packageVersion}，构建产物版本为 ${releaseVersion}。请重新运行 npm run build。`);
}

process.env.XHS_SIMULATOR_PLUGIN_ROOT ||= ROOT_DIR;
await import(pathToFileURL(SERVER_PATH).href);
