import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const serverRootIndex = process.argv.indexOf("--server-root");
const ROOT_DIR = serverRootIndex >= 0
  ? path.resolve(process.argv[serverRootIndex + 1])
  : process.cwd();
const dataDir = await mkdtemp(path.join(tmpdir(), "xhs-simulator-probe-"));
const transport = new StdioClientTransport({
  command: "node",
  args: ["./scripts/start-mcp.mjs"],
  cwd: ROOT_DIR,
  env: {
    ...process.env,
    XHS_SIMULATOR_DATA_DIR: dataDir,
  },
});
const client = new Client({ name: "xhs-simulator-probe", version: "0.1.0" });

try {
  await client.connect(transport);
  const listed = await client.listTools();
  const required = [
    "render_xhs_simulator_widget",
    "get_xhs_personas",
    "list_xhs_runs",
    "get_xhs_run",
    "save_xhs_run",
    "get_xhs_selection",
    "save_xhs_selection",
  ];
  const names = new Set(listed.tools.map((tool) => tool.name));
  for (const name of required) {
    if (!names.has(name)) throw new Error(`缺少 MCP 工具：${name}`);
  }

  const render = await client.callTool({ name: "render_xhs_simulator_widget", arguments: {} });
  if (render._meta?.["openai/outputTemplate"] !== "ui://widget/xhs-simulator/index.html") {
    throw new Error("Widget outputTemplate 不正确。");
  }
  const resource = await client.readResource({ uri: "ui://widget/xhs-simulator/index.html" });
  if (!resource.contents?.[0]?.text?.includes("小红书笔记反应模拟器")) {
    throw new Error("Widget 资源没有包含应用标题。");
  }

  const personasResult = await client.callTool({
    name: "get_xhs_personas",
    arguments: { personaIds: ["m01", "m02"], includeSamples: true },
  });
  if (personasResult.structuredContent?.personas?.length !== 2) {
    throw new Error("人设读取结果不正确。");
  }

  const requestId = "probe-request-001";
  const saved = await client.callTool({
    name: "save_xhs_run",
    arguments: {
      requestId,
      noteText: "这是一篇用于验证 Codex Widget 迁移链路的小红书测试笔记。",
      settings: { personaIds: ["m01", "m02"], rounds: 2, passerby: 0, seed: 42 },
      noteCard: {
        title: "Widget 迁移测试",
        category: "测试",
        selling_points: ["本地运行"],
        emotional_hooks: [],
        sensitive_points: [],
        target_audience_hints: ["测试用户"],
        tone: "测评向",
      },
      reactions: [
        { id: "m01", relevance: 0.9, behavior: "评论", attitude: "观望", trigger: "本地运行" },
        { id: "m02", relevance: 0.8, behavior: "评论", attitude: "质疑", trigger: "迁移链路" },
      ],
      comments: [
        { cid: 1, persona: "m01", attitude: "观望", text: "先蹲个反馈", parent: null, round: 0 },
        { cid: 2, persona: "m02", attitude: "质疑", text: "真的不用key吗", parent: 1, round: 1 },
      ],
      reportMarkdown: "# 测试报告\n\n链路正常。",
    },
  });
  const runId = saved.structuredContent?.run_id;
  if (!runId) throw new Error("保存工具没有返回 run_id。");

  const loaded = await client.callTool({ name: "get_xhs_run", arguments: { requestId } });
  if (loaded.structuredContent?.comments?.length !== 2) throw new Error("结果回读失败。");
  if (loaded.structuredContent.comments[1].parent !== 1) throw new Error("评论树关系丢失。");

  const selectionId = "probe-selection-001";
  await client.callTool({
    name: "save_xhs_selection",
    arguments: {
      requestId: selectionId,
      runId,
      instruction: "正向和质疑各 50%",
      mode: "quota",
      total: 2,
      quotas: [{ label: "正向", pct: 50 }, { label: "质疑", pct: 50 }],
      assignments: { "1": "正向", "2": "质疑" },
    },
  });
  const selection = await client.callTool({
    name: "get_xhs_selection",
    arguments: { requestId: selectionId },
  });
  if (selection.structuredContent?.selected?.length !== 2) throw new Error("精确配比或关系闭包失败。");

  const release = JSON.parse(await readFile(path.join(ROOT_DIR, "mcp", "generated", "release-manifest.json"), "utf8"));
  console.log(`OK: MCP、Widget、人设、结果存储和精确挑选均通过（v${release.version}）。`);
} finally {
  await client.close().catch(() => undefined);
  await rm(dataDir, { recursive: true, force: true });
}
