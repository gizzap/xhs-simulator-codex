import { execFile } from "node:child_process";
import { cp, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const ROOT_DIR = process.cwd();
const coldRoot = await mkdtemp(path.join(tmpdir(), "xhs-simulator-cold-"));

try {
  for (const relative of [
    ".codex-plugin",
    ".mcp.json",
    "package.json",
    "config/personas.yaml",
    "config/personas_milk.yaml",
    "mcp/generated",
    "scripts/start-mcp.mjs",
  ]) {
    const source = path.join(ROOT_DIR, relative);
    const target = path.join(coldRoot, relative);
    await mkdir(path.dirname(target), { recursive: true });
    await cp(source, target, { recursive: true });
  }

  const { stdout, stderr } = await execFileAsync(
    process.execPath,
    [path.join(ROOT_DIR, "scripts", "probe-mcp.mjs"), "--server-root", coldRoot],
    { cwd: ROOT_DIR, maxBuffer: 2_000_000 },
  );
  if (stderr.trim()) process.stderr.write(stderr);
  process.stdout.write(stdout);
  console.log("OK: 预构建插件在无 node_modules 的冷安装目录中可启动。");
} finally {
  await rm(coldRoot, { recursive: true, force: true });
}
