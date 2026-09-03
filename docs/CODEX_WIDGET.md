# Codex Widget 版本

`codex-widget` 分支把原来的“Vue → FastAPI → LiteLLM/API Key”改成：

```text
Vue Widget → 当前 Codex 任务 → xhs-simulator Skill
      ↑                              ↓
      └──── 本地 MCP 读取/保存结果 ──┘
```

## 安装与使用

插件按需打开，不启动浏览器或 localhost，也不要求 `XHS_API_KEY`。

把 GitHub 仓库注册为 Codex marketplace：

```bash
codex plugin marketplace add gizzap/xhs-simulator-codex --ref main
codex plugin add xhs-simulator@xhs-simulator-github
codex plugin list
```

安装或升级后完全退出并重新启动 Codex，再新建一个任务并输入：

```text
打开小红书评论模拟器
```

点击 Widget 的“开始模拟”后，Widget 会把参数作为一条后续消息交给当前 Codex 任务。Codex 按 Skill 读取本地人设、生成结构化结果，再由 MCP 保存；Widget 会自动轮询并展示。

新结果保存在：

```text
~/.xhs-simulator/runs/
```

升级插件：

```bash
codex plugin marketplace upgrade xhs-simulator-github
codex plugin add xhs-simulator@xhs-simulator-github
```

仓库已经包含预构建的 MCP 和单文件 Widget，使用者不需要安装 npm/Python 依赖。Node.js 由 Codex 插件运行环境调用。

## 维护者构建与验证

```bash
npm install
npm run quality
python3 /path/to/plugin-creator/scripts/validate_plugin.py .
python3 /path/to/skill-creator/scripts/quick_validate.py skills/xhs-simulator
./web/node_modules/.bin/vue-tsc -p web/tsconfig.app.json --noEmit
```

`npm run quality` 会重新构建 Vue、生成 `mcp/generated/xhs-widget.html` 与 `xhs-mcp.mjs`，检查内联脚本内容与语法，再冷启动 MCP，验证 Widget 资源、人设读取、结果存取、最大余数配比和评论关系闭包。

发布前还需执行浏览器回归（维护者需安装 Python Playwright 和 Chromium，使用者无需安装）：

```bash
python3 scripts/probe-widget-render.py
python3 scripts/probe-widget-render.py mcp/generated/xhs-widget.html --same-origin
```

浏览器测试执行实际发布 HTML，覆盖 iframe 可见性、初始化握手、人设加载、侧栏折叠、全屏请求和模拟消息交接；宿主与工具数据使用本地测试夹具，不调用模型。MCP 工具返回成功不能代替 Codex 客户端中的实际显示确认。

## 实现说明

- 插件运行路径不会调用旧 FastAPI、Python LLM 适配器或 `.env`。
- 智能挑选分为“Codex 语义分类”和“MCP 代码精确配比”两段，避免模型自行计算百分比造成名额漂移。
- 模拟结果只保存在用户本机的 `~/.xhs-simulator/`，不会提交到插件仓库。
