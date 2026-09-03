import { readFileSync } from "node:fs";
import { access, mkdir, readdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { parse as parseYaml } from "yaml";
import { z } from "zod";

const ROOT_DIR = resolve(
  process.env.XHS_SIMULATOR_PLUGIN_ROOT || resolve(dirname(fileURLToPath(import.meta.url)), ".."),
);
const DATA_DIR = resolve(process.env.XHS_SIMULATOR_DATA_DIR || join(homedir(), ".xhs-simulator"));
const RUNS_DIR = join(DATA_DIR, "runs");
const REQUESTS_DIR = join(DATA_DIR, "requests");
const SELECTIONS_DIR = join(DATA_DIR, "selections");
const LEGACY_RUNS_DIR = join(ROOT_DIR, "data", "runs");
const WIDGET_URI = "ui://widget/xhs-simulator/index.html";
const WIDGET_PATH = join(ROOT_DIR, "mcp", "generated", "xhs-widget.html");
const MIME_TYPE = "text/html;profile=mcp-app";

const manifest = JSON.parse(
  readFileSync(join(ROOT_DIR, ".codex-plugin", "plugin.json"), "utf8"),
);

const behaviorSchema = z.enum(["划走", "点赞", "收藏", "评论", "分享"]);
const attitudeSchema = z.enum(["种草", "观望", "质疑", "反感", "无感"]);
const quotaSchema = z.object({
  label: z.string().trim().min(1),
  pct: z.number().min(0).max(100),
});

const server = new McpServer(
  { name: manifest.name, version: manifest.version },
  {
    instructions:
      "Open the XHS Simulator with render_xhs_simulator_widget. The widget sends simulation and selection requests back to Codex. Use get_xhs_personas/get_xhs_run as inputs, then save results with save_xhs_run/save_xhs_selection. Never require an API key.",
  },
);

registerWidget();
registerPersonaTools();
registerRunTools();
registerSelectionTools();

const transport = new StdioServerTransport();
await server.connect(transport);

function registerWidget() {
  server.registerResource("xhs-simulator-widget", WIDGET_URI, {}, async () => ({
    contents: [
      {
        uri: WIDGET_URI,
        mimeType: MIME_TYPE,
        text: await readFile(WIDGET_PATH, "utf8"),
        _meta: {
          ui: {
            prefersBorder: false,
            csp: { connectDomains: [], resourceDomains: [] },
          },
          "openai/widgetDescription": "小红书笔记发布前评论区压力测试工具。",
          "openai/widgetPrefersBorder": false,
          "openai/widgetCSP": { connect_domains: [], resource_domains: [] },
        },
      },
    ],
  }));

  server.registerTool(
    "render_xhs_simulator_widget",
    {
      title: "打开小红书评论模拟器",
      description:
        "按需打开或刷新小红书评论模拟器原生 Widget。正常模拟和挑选过程中不要重复调用。",
      inputSchema: {
        displayMode: z.enum(["inline", "fullscreen"]).optional(),
      },
      annotations: readOnlyAnnotations(),
      _meta: {
        ui: { resourceUri: WIDGET_URI, visibility: ["model", "app"] },
        "ui/resourceUri": WIDGET_URI,
        "openai/outputTemplate": WIDGET_URI,
        "openai/widgetAccessible": true,
        "openai/toolInvocation/invoking": "正在打开模拟器…",
        "openai/toolInvocation/invoked": "模拟器已打开",
      },
    },
    async ({ displayMode } = {}) => ({
      content: [{ type: "text", text: "已打开小红书评论模拟器 Widget。" }],
      structuredContent: {
        widget: "xhs-simulator",
        version: manifest.version,
        preferredDisplayMode: displayMode || "fullscreen",
        storageDir: DATA_DIR,
      },
      _meta: {
        "openai/outputTemplate": WIDGET_URI,
        widgetData: {
          preferredDisplayMode: displayMode || "fullscreen",
          storageDir: DATA_DIR,
        },
      },
    }),
  );
}

function registerPersonaTools() {
  server.registerTool(
    "get_xhs_personas",
    {
      title: "读取小红书模拟人设",
      description:
        "读取本地人设。Widget 列表使用摘要；执行模拟时传 personaIds、passerby、seed 和 includeSamples=true。",
      inputSchema: {
        bank: z.string().trim().optional(),
        personaIds: z.array(z.string().trim().min(1)).optional(),
        passerby: z.number().int().min(0).max(10).optional(),
        seed: z.number().int().optional(),
        includeSamples: z.boolean().optional(),
      },
      annotations: readOnlyAnnotations(),
      _meta: appVisibleMeta(),
    },
    async (input = {}) => {
      const bank = input.bank || "personas_milk.yaml";
      const personas = await selectPersonas({
        bank,
        personaIds: input.personaIds,
        passerby: input.passerby || 0,
        seed: input.seed || 42,
      });
      const output = personas.map((persona) =>
        input.includeSamples ? persona : personaSummary(persona),
      );
      return dataResult(
        { bank, personas: output },
        `已读取 ${output.length} 个人设。`,
      );
    },
  );
}

function registerRunTools() {
  server.registerTool(
    "list_xhs_runs",
    {
      title: "读取模拟历史",
      description: "列出本机保存的模拟历史，包含旧独立版的项目内历史。",
      inputSchema: { limit: z.number().int().min(1).max(100).optional() },
      annotations: readOnlyAnnotations(),
      _meta: appVisibleMeta(),
    },
    async ({ limit } = {}) => {
      const runs = (await listRuns()).slice(0, limit || 50);
      return dataResult({ runs }, `找到 ${runs.length} 次模拟。`);
    },
  );

  server.registerTool(
    "get_xhs_run",
    {
      title: "读取模拟结果",
      description: "按 runId 读取结果；Widget 也可按 requestId 轮询等待 Codex 保存。",
      inputSchema: {
        runId: z.string().trim().optional(),
        requestId: z.string().trim().optional(),
      },
      annotations: readOnlyAnnotations(),
      _meta: appVisibleMeta(),
    },
    async ({ runId, requestId } = {}) => {
      if (!runId && !requestId) throw new Error("runId 和 requestId 至少提供一个。");
      const resolvedRunId = runId || (await runIdForRequest(requestId));
      if (!resolvedRunId) return dataResult({ status: "pending" }, "结果仍在生成中。");
      const run = await readRun(resolvedRunId);
      if (!run && runId) throw new Error(`运行不存在：${runId}`);
      if (!run) return dataResult({ status: "pending" }, "结果仍在生成中。");
      return dataResult({ ...run, status: "done", run_id: resolvedRunId }, "已读取模拟结果。");
    },
  );

  server.registerTool(
    "save_xhs_run",
    {
      title: "保存 Codex 模拟结果",
      description:
        "保存当前 Codex 会话生成的完整小红书模拟结果。必须使用 Widget 原始 requestId。",
      inputSchema: {
        requestId: z.string().trim().min(4),
        noteText: z.string().trim().min(10),
        settings: z.object({
          personaIds: z.array(z.string().trim().min(1)).min(1),
          rounds: z.number().int().min(1).max(8),
          passerby: z.number().int().min(0).max(10),
          seed: z.number().int(),
          bank: z.string().trim().optional(),
        }),
        noteCard: z.object({
          title: z.string(),
          category: z.string(),
          selling_points: z.array(z.string()),
          emotional_hooks: z.array(z.string()),
          sensitive_points: z.array(z.string()),
          target_audience_hints: z.array(z.string()),
          tone: z.string(),
        }),
        reactions: z.array(
          z.object({
            id: z.string(),
            relevance: z.number().min(0).max(1),
            behavior: behaviorSchema,
            attitude: attitudeSchema,
            trigger: z.string(),
          }),
        ),
        comments: z.array(
          z.object({
            cid: z.number().int().positive(),
            persona: z.string(),
            attitude: attitudeSchema,
            text: z.string().trim().min(1).max(240),
            parent: z.number().int().positive().nullable().optional(),
            round: z.number().int().min(0).max(8),
          }),
        ),
        reportMarkdown: z.string(),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
      _meta: { ui: { visibility: ["model"] } },
    },
    async (input) => {
      const existingRunId = await runIdForRequest(input.requestId);
      if (existingRunId) {
        return dataResult({ status: "done", run_id: existingRunId }, "该请求已保存。" );
      }

      const participants = await selectPersonas({
        bank: input.settings.bank || "personas_milk.yaml",
        personaIds: input.settings.personaIds,
        passerby: input.settings.passerby,
        seed: input.settings.seed,
      });
      const personaById = new Map(participants.map((persona) => [persona.id, persona]));
      const reactions = validateReactions(input.reactions, participants);
      const comments = normalizeComments(input.comments, personaById, input.settings);
      assignLikes(comments, input.settings.seed);

      const timestamp = new Date().toISOString();
      const runId = `${compactTimestamp(timestamp)}_${safeToken(input.requestId).slice(0, 6)}`;
      const runData = {
        timestamp,
        model: "Codex session",
        note_text: input.noteText,
        note_card: input.noteCard,
        reactions,
        comments,
        report_md: input.reportMarkdown,
        personas_used: participants.map((persona) => persona.id),
        passerby_ids: participants.filter((persona) => persona.source === "passerby").map((persona) => persona.id),
        rounds: input.settings.rounds,
        seed: input.settings.seed,
        request_id: input.requestId,
      };

      await atomicJsonWrite(join(RUNS_DIR, `${safeToken(runId)}.json`), runData);
      await atomicJsonWrite(join(REQUESTS_DIR, `${safeToken(input.requestId)}.json`), { run_id: runId });
      return dataResult(
        { status: "done", run_id: runId, n_comments: comments.length },
        `已保存 ${comments.length} 条评论。`,
      );
    },
  );
}

function registerSelectionTools() {
  server.registerTool(
    "get_xhs_selection",
    {
      title: "读取评论挑选结果",
      description: "Widget 按 requestId 轮询评论挑选结果。",
      inputSchema: { requestId: z.string().trim().min(4) },
      annotations: readOnlyAnnotations(),
      _meta: appVisibleMeta(),
    },
    async ({ requestId }) => {
      const path = join(SELECTIONS_DIR, `${safeToken(requestId)}.json`);
      const selection = await readJsonIfExists(path);
      return selection
        ? dataResult({ ...selection, status: "done" }, "已读取评论挑选结果。")
        : dataResult({ status: "pending" }, "评论仍在挑选中。");
    },
  );

  server.registerTool(
    "save_xhs_selection",
    {
      title: "保存 Codex 评论挑选结果",
      description:
        "保存直接挑选，或根据 Codex 的语义分类用代码精确执行配比和关系闭包。",
      inputSchema: {
        requestId: z.string().trim().min(4),
        runId: z.string().trim().min(1),
        instruction: z.string().trim().min(2),
        mode: z.enum(["direct", "quota"]),
        selected: z.array(z.number().int().positive()).optional(),
        summary: z.string().optional(),
        total: z.number().int().positive().optional(),
        quotas: z.array(quotaSchema).optional(),
        assignments: z.record(z.string(), z.string()).optional(),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
      _meta: { ui: { visibility: ["model"] } },
    },
    async (input) => {
      const run = await readRun(input.runId);
      if (!run) throw new Error(`运行不存在：${input.runId}`);
      const comments = Array.isArray(run.comments) ? run.comments : [];
      const validCids = new Set(comments.map((comment) => comment.cid));
      let selected;
      let summary;

      if (input.mode === "quota") {
        if (!input.quotas?.length || !input.assignments) {
          throw new Error("quota 模式需要 quotas 和 assignments。");
        }
        const result = selectByQuota(comments, input.total, input.quotas, input.assignments);
        selected = result.selected;
        summary = result.summary;
      } else {
        selected = [...new Set((input.selected || []).filter((cid) => validCids.has(cid)))];
        summary = input.summary || `按指令选出 ${selected.length} 条评论`;
      }

      selected = input.mode === "quota"
        ? relationshipClosure(new Set(selected), comments)
        : new Set(selected);
      const result = {
        request_id: input.requestId,
        run_id: input.runId,
        instruction: input.instruction,
        mode: input.mode,
        selected: [...selected].sort((a, b) => a - b),
        summary: input.mode === "quota"
          ? `${summary}；含关系闭包共 ${selected.size} 条`
          : summary,
      };
      await atomicJsonWrite(join(SELECTIONS_DIR, `${safeToken(input.requestId)}.json`), result);
      return dataResult(result, `已保存 ${selected.size} 条挑选结果。`);
    },
  );
}

async function loadBank(bank) {
  const safeBank = bank === "personas.yaml" ? "personas.yaml" : "personas_milk.yaml";
  const text = await readFile(join(ROOT_DIR, "config", safeBank), "utf8");
  const parsed = parseYaml(text);
  return Array.isArray(parsed?.personas) ? parsed.personas : [];
}

async function selectPersonas({ bank, personaIds, passerby, seed }) {
  const primary = await loadBank(bank);
  const idSet = new Set(personaIds || primary.map((persona) => persona.id));
  const selected = primary
    .filter((persona) => idSet.has(persona.id))
    .map((persona) => ({ ...persona, source: persona.source || "target" }));

  if (personaIds?.length) {
    const found = new Set(selected.map((persona) => persona.id));
    const missing = personaIds.filter((id) => !found.has(id));
    if (missing.length) throw new Error(`人设不存在：${missing.join(", ")}`);
  }

  if (passerby > 0) {
    const general = await loadBank("personas.yaml");
    const pool = general.filter((persona) => !idSet.has(persona.id));
    const random = seededRandom(seed);
    for (let index = pool.length - 1; index > 0; index -= 1) {
      const other = Math.floor(random() * (index + 1));
      [pool[index], pool[other]] = [pool[other], pool[index]];
    }
    selected.push(...pool.slice(0, passerby).map((persona) => ({ ...persona, source: "passerby" })));
  }
  return selected;
}

function personaSummary(persona) {
  const samples = persona.samples || (persona.sample ? [persona.sample] : []);
  return {
    id: persona.id,
    name: persona.name,
    age: persona.age,
    city: persona.city,
    occupation: persona.occupation,
    tags: (persona.tags || []).slice(0, 4),
    style: String(persona.style || "").slice(0, 80),
    expressiveness: persona.expressiveness ?? 0.5,
    always_active: Boolean(persona.always_active),
    has_samples: samples.length >= 2,
  };
}

function validateReactions(reactions, participants) {
  const expected = new Set(participants.map((persona) => persona.id));
  const byId = new Map();
  for (const reaction of reactions) {
    if (!expected.has(reaction.id)) throw new Error(`反应包含未参与人设：${reaction.id}`);
    byId.set(reaction.id, reaction);
  }
  const missing = [...expected].filter((id) => !byId.has(id));
  if (missing.length) throw new Error(`缺少人设反应：${missing.join(", ")}`);
  return participants.map((persona) => byId.get(persona.id));
}

function normalizeComments(inputComments, personaById, settings) {
  const sorted = [...inputComments].sort((a, b) => a.cid - b.cid);
  const oldToNew = new Map(sorted.map((comment, index) => [comment.cid, index + 1]));
  const seenOld = new Set();
  const comments = [];

  for (let index = 0; index < sorted.length; index += 1) {
    const input = sorted[index];
    if (!personaById.has(input.persona)) throw new Error(`评论包含未参与人设：${input.persona}`);
    if (seenOld.has(input.cid)) throw new Error(`评论楼号重复：${input.cid}`);
    seenOld.add(input.cid);
    const persona = personaById.get(input.persona);
    const mappedParent = input.parent == null ? null : oldToNew.get(input.parent) || null;
    const parentComment = mappedParent ? comments[mappedParent - 1] : null;
    const parent = mappedParent && mappedParent <= index && parentComment?.persona !== input.persona
      ? mappedParent
      : null;
    comments.push({
      cid: index + 1,
      persona: input.persona,
      persona_name: persona.name,
      attitude: input.attitude,
      text: input.text.trim(),
      parent,
      round: Math.min(input.round, settings.rounds),
      likes: 0,
      source: persona.source || "target",
    });
  }
  return comments;
}

function assignLikes(comments, seed) {
  const random = seededRandom(seed);
  for (const comment of comments) {
    const u = Math.min(0.999999, Math.max(0.000001, random()));
    const pareto = Math.pow(1 - u, -1 / 1.6) - 1;
    const bonus = ["质疑", "反感", "种草"].includes(comment.attitude) ? 15 : 0;
    comment.likes = Math.floor(pareto * 8) + bonus + Math.floor(random() * 5);
  }
}

function selectByQuota(comments, requestedTotal, quotas, assignments) {
  const total = Math.min(
    Number.isInteger(requestedTotal) && requestedTotal > 0
      ? requestedTotal
      : Math.max(Math.floor(comments.length / 3), Math.min(5, comments.length)),
    comments.length,
  );
  const labels = new Set(quotas.map((quota) => quota.label));
  const groups = new Map([...labels].map((label) => [label, []]));
  for (const comment of comments) {
    const label = assignments[String(comment.cid)];
    if (labels.has(label)) groups.get(label).push(comment);
  }

  const raw = quotas.map((quota) => ({
    label: quota.label,
    value: (total * quota.pct) / 100,
  }));
  const counts = new Map(raw.map((item) => [item.label, Math.floor(item.value)]));
  let remain = total - [...counts.values()].reduce((sum, value) => sum + value, 0);
  const remainders = [...raw].sort(
    (a, b) => (b.value - Math.floor(b.value)) - (a.value - Math.floor(a.value)),
  );
  for (let index = 0; index < remainders.length && remain > 0; index += 1, remain -= 1) {
    const label = remainders[index].label;
    counts.set(label, (counts.get(label) || 0) + 1);
  }

  const parentIds = new Set(comments.map((comment) => comment.parent).filter(Boolean));
  const selected = new Set();
  const stats = [];
  for (const quota of quotas) {
    const count = counts.get(quota.label) || 0;
    const pool = [...(groups.get(quota.label) || [])].sort((a, b) => {
      const aThread = Boolean(a.parent || parentIds.has(a.cid));
      const bThread = Boolean(b.parent || parentIds.has(b.cid));
      return Number(bThread) - Number(aThread) || (b.likes || 0) - (a.likes || 0);
    });
    const picked = pool.slice(0, count);
    picked.forEach((comment) => selected.add(comment.cid));
    stats.push(`${quota.label} ${picked.length}/${count}`);
  }
  return { selected: [...selected], summary: `配比执行：${stats.join("；")}` };
}

function relationshipClosure(selected, comments) {
  const byCid = new Map(comments.map((comment) => [comment.cid, comment]));
  let changed = true;
  while (changed) {
    changed = false;
    for (const comment of comments) {
      if (selected.has(comment.cid) && comment.parent && byCid.has(comment.parent) && !selected.has(comment.parent)) {
        selected.add(comment.parent);
        changed = true;
      }
      if (comment.parent && selected.has(comment.parent) && !selected.has(comment.cid)) {
        selected.add(comment.cid);
        changed = true;
      }
    }
  }
  return selected;
}

async function listRuns() {
  const found = new Map();
  for (const directory of [RUNS_DIR, LEGACY_RUNS_DIR]) {
    for (const file of await jsonFiles(directory)) {
      const runId = file.slice(0, -5);
      if (found.has(runId)) continue;
      let data;
      try {
        data = await readJsonIfExists(join(directory, file));
      } catch {
        continue;
      }
      if (!data) continue;
      found.set(runId, {
        run_id: runId,
        timestamp: data.timestamp || "",
        model: data.model || "",
        category: data.note_card?.category || "",
        tone: data.note_card?.tone || "",
        n_comments: Array.isArray(data.comments) ? data.comments.length : 0,
        summary: String(data.note_card?.summary || data.note_card?.title || "").slice(0, 80),
      });
    }
  }
  return [...found.values()].sort((a, b) => String(b.timestamp).localeCompare(String(a.timestamp)));
}

async function readRun(runId) {
  const safeId = safeToken(runId);
  for (const directory of [RUNS_DIR, LEGACY_RUNS_DIR]) {
    const data = await readJsonIfExists(join(directory, `${safeId}.json`));
    if (data) return data;
  }
  return null;
}

async function runIdForRequest(requestId) {
  if (!requestId) return null;
  const pointer = await readJsonIfExists(join(REQUESTS_DIR, `${safeToken(requestId)}.json`));
  return pointer?.run_id || null;
}

async function jsonFiles(directory) {
  try {
    return (await readdir(directory)).filter((file) => file.endsWith(".json"));
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
}

async function readJsonIfExists(path) {
  try {
    await access(path);
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

async function atomicJsonWrite(path, value) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temporary, path);
}

function safeToken(value) {
  const token = String(value || "").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 120);
  if (!token) throw new Error("非法标识符。");
  return token;
}

function compactTimestamp(timestamp) {
  return timestamp.replace(/[-:]/g, "").replace("T", "_").replace(/\.\d{3}Z$/, "");
}

function seededRandom(seed) {
  let state = Number(seed) >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function dataResult(structuredContent, text) {
  return {
    structuredContent,
    content: [{ type: "text", text }],
  };
}

function readOnlyAnnotations() {
  return {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  };
}

function appVisibleMeta() {
  return {
    ui: { visibility: ["model", "app"] },
    "openai/widgetAccessible": true,
  };
}
