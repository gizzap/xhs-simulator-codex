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
npm --prefix web install
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
npm run probe:copy
```

浏览器测试执行实际发布 HTML，覆盖 iframe 可见性、初始化握手、人设加载、侧栏折叠、全屏请求和模拟消息交接；宿主与工具数据使用本地测试夹具，不调用模型。MCP 工具返回成功不能代替 Codex 客户端中的实际显示确认。

复制回归会向系统剪贴板写入虚构测试评论，然后通过键盘粘贴验证内容；不会读取原有剪贴板，测试会覆盖它。覆盖允许权限的 Clipboard API、权限被禁止时的 execCommand、两者失败时的手动全选复制，以及不带 allow-same-origin 的严格沙箱。测试按完整 18 条、孤立深层筛选、表格单行格式逐条断言，不以 Toast 代替真实粘贴。

同一回归还覆盖独立浏览器的 `/api` 数据通道，使用虚构数据，不请求本机旧服务或实际模型。

### 复制权限与后备入口

资源元数据声明 `_meta.ui.permissions.clipboardWrite = {}`，由宿主决定是否为 iframe 授权；不能把资源权限放到工具元数据里。宿主未授权也不影响手动全选与快捷键复制。新版标题显示 v0.2.0，便于确认没有继续使用旧 Widget。

「表格格式」只影响复制文本，不改历史结果。关闭时保留原文换行；开启时将评论内换行、制表符合并成空格，一条评论对应一行。复制文本保留序号与楼层深度标签；单独复制回复不会自动附带未选中的父楼。

### 参与校准

Skill 先产生完整原始反应，再调用 `calibrate_xhs_reactions`；MCP 对被判为评论的非常驻路人做 0.45 概率保留，并返回首评名单。目标人设不削弱，常驻人设强制参与。保存校准后反应时只验证首评一致性，不再抽样或删除评论。seed=0 有效，同一原始输入可确定性重试。后续发言疲劳由 Skill 约束，不声称与 Python 随机算法逐条一致。

## 实现说明

- 插件运行路径不会调用旧 FastAPI、Python LLM 适配器或 `.env`。
- 智能挑选分为“Codex 语义分类”和“MCP 代码精确配比”两段，避免模型自行计算百分比造成名额漂移。
- 模拟结果只保存在用户本机的 `~/.xhs-simulator/`，不会提交到插件仓库。
