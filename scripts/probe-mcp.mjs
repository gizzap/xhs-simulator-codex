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
    "calibrate_xhs_reactions",
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

  const renderTool = listed.tools.find((tool) => tool.name === "render_xhs_simulator_widget");
  if (renderTool?._meta?.ui?.resourceUri !== "ui://widget/xhs-simulator/index.html") {
    throw new Error("Widget 工具缺少 MCP Apps resourceUri。");
  }

  const render = await client.callTool({ name: "render_xhs_simulator_widget", arguments: {} });
  if (render._meta?.["openai/outputTemplate"] !== "ui://widget/xhs-simulator/index.html") {
    throw new Error("Widget outputTemplate 不正确。");
  }
  const resource = await client.readResource({ uri: "ui://widget/xhs-simulator/index.html" });
  if (!resource.contents?.[0]?._meta?.ui?.permissions?.clipboardWrite) {
    throw new Error("Widget 未声明剪贴板写入权限。");
  }
  if (resource.contents?.[0]?.mimeType !== "text/html;profile=mcp-app") {
    throw new Error("Widget 资源 MIME 类型不符合 MCP Apps 规范。");
  }
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

  const participantsInput = { personaIds: Array.from({ length: 24 }, (_, i) => `m${String(i + 1).padStart(2, '0')}`), passerby: 40, seed: 0 };
  const expanded = await client.callTool({ name: "get_xhs_personas", arguments: { ...participantsInput, includeSamples: true } });
  const participants = expanded.structuredContent?.personas;
  if (participants?.length !== 64 || new Set(participants.map(p => p.id)).size !== 64) throw new Error("40 路人读取失败或重复。");
  const excessive = await client.callTool({ name: "get_xhs_personas", arguments: { ...participantsInput, passerby: 41 } });
  if (!excessive.isError) throw new Error("未拒绝超过 40 的路人配置。");
  const rawReactions = participants.map(p => ({ id: p.id, relevance: 0.8, behavior: "评论", attitude: "观望", trigger: "测试" }));
  const calibrationInput = { ...participantsInput, reactions: rawReactions };
  const calibrated = await client.callTool({ name: "calibrate_xhs_reactions", arguments: calibrationInput });
  const repeated = await client.callTool({ name: "calibrate_xhs_reactions", arguments: calibrationInput });
  if (calibrated.isError || JSON.stringify(calibrated.structuredContent) !== JSON.stringify(repeated.structuredContent)) throw new Error("校准不确定或失败。");
  const reactions = calibrated.structuredContent.reactions;
  if (reactions.length !== 64) throw new Error("校准丢失反应。");
  if (reactions.some((r, i) => (participants[i].source !== "passerby" || participants[i].always_active) && r.behavior !== "评论")) throw new Error("校准削弱了目标或常驻人设。");
  const eligible = participants.filter(p => p.source === "passerby" && !p.always_active);
  const retained = eligible.filter(p => reactions.find(r => r.id === p.id).behavior === "评论").length;
  if (!retained || retained >= eligible.length) throw new Error("路人校准未生效。");
  const firstIds = reactions.filter(r => r.behavior === "评论").map(r => r.id);
  if (JSON.stringify(firstIds) !== JSON.stringify(calibrated.structuredContent.first_comment_persona_ids)) throw new Error("首评名单与校准结果不一致。");

  const expandedSave = {
    requestId: "expanded-request-001",
    noteText: "用于验证四十位路人、首轮校准与多轮参与的虚构测试笔记。",
    settings: { ...participantsInput, rounds: 3 },
    noteCard: { title: "校准测试", category: "测试", selling_points: [], emotional_hooks: [], sensitive_points: [], target_audience_hints: [], tone: "测试" },
    reactions,
    comments: firstIds.map((id, i) => ({ cid: i + 1, persona: id, attitude: "观望", text: "虚构首评", parent: null, round: 0 })),
    reportMarkdown: "# 测试\n校准工具回归。",
  };
  const lateJoiner = calibrated.structuredContent.downgraded_persona_ids[0];
  expandedSave.comments.push({ cid: firstIds.length + 1, persona: lateJoiner, attitude: "观望", text: "此前只点赞，现在被讨论吸引而加入", parent: 1, round: 1 });
  expandedSave.comments.push({ cid: firstIds.length + 2, persona: firstIds[0], attitude: "观望", text: "同一个人下一轮补充新观点", parent: firstIds.length + 1, round: 2 });
  const badFirst = await client.callTool({ name: "save_xhs_run", arguments: { ...expandedSave, comments: [...expandedSave.comments, { cid: firstIds.length + 3, persona: lateJoiner, attitude: "观望", text: "不应发出的首评", parent: null, round: 0 }] } });
  if (!badFirst.isError) throw new Error("未拒绝校准后不在名单中的首评。");
  const missingFirst = await client.callTool({ name: "save_xhs_run", arguments: { ...expandedSave, comments: expandedSave.comments.slice(1) } });
  if (!missingFirst.isError) throw new Error("未拒绝缺失的首评。");
  const badCount = await client.callTool({ name: "save_xhs_run", arguments: { ...expandedSave, settings: { ...expandedSave.settings, passerby: 41 } } });
  if (!badCount.isError) throw new Error("保存时未拒绝超过 40 的路人配置。");
  const savedExpanded = await client.callTool({ name: "save_xhs_run", arguments: expandedSave });
  if (savedExpanded.isError) throw new Error(JSON.stringify(savedExpanded));
  const expandedRead = await client.callTool({ name: "get_xhs_run", arguments: { requestId: expandedSave.requestId } });
  if (JSON.stringify(expandedRead.structuredContent.reactions) !== JSON.stringify(reactions)) throw new Error("保存时重新削减了反应。");
  if (expandedRead.structuredContent.comments.length !== firstIds.length + 2 || expandedRead.structuredContent.comments.at(-1).parent !== firstIds.length + 1) throw new Error("新加入者、重复参与者或深层回复丢失。");
  if (expandedRead.structuredContent.passerby_ids.length !== 40) throw new Error("路人来源丢失。");
  const savedAgain = await client.callTool({ name: "save_xhs_run", arguments: expandedSave });
  if (savedAgain.structuredContent?.run_id !== savedExpanded.structuredContent.run_id) throw new Error("保存重试不幂等。");
  const duplicate = await client.callTool({ name: "calibrate_xhs_reactions", arguments: { ...calibrationInput, reactions: [...rawReactions, rawReactions[0]] } });
  if (!duplicate.isError) throw new Error("校准未拒绝重复反应。");

  let trials = 0;
  let kept = 0;
  for (let seed = 1; seed <= 25; seed++) {
    const settings = { ...participantsInput, seed };
    const poolResult = await client.callTool({ name: "get_xhs_personas", arguments: { ...settings, includeSamples: true } });
    const pool = poolResult.structuredContent.personas;
    const sampled = await client.callTool({ name: "calibrate_xhs_reactions", arguments: { ...settings, reactions: pool.map(p => ({ id: p.id, relevance: 0.8, behavior: "评论", attitude: "观望", trigger: "抽样测试" })) } });
    for (const persona of pool.filter(p => p.source === "passerby" && !p.always_active)) {
      trials++;
      if (sampled.structuredContent.first_comment_persona_ids.includes(persona.id)) kept++;
    }
  }
  if (kept / trials < 0.39 || kept / trials > 0.51) throw new Error(`校准保留率异常：${kept}/${trials}`);
  console.log(`OK: 路人校准保留 ${kept}/${trials}，40 人保存、seed=0、重试与后续参与均通过。`);

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
        { id: "m02", relevance: 0.8, behavior: "点赞", attitude: "质疑", trigger: "迁移链路" },
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
