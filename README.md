# XHS Simulator for Codex

一个按需打开的 Codex 原生 Widget，用当前 Codex 任务模拟小红书笔记发布后的用户反应、评论树和风险洞察。

- 无用户系统、无独立后端服务
- 不需要额外配置模型 API Key
- 不启动浏览器、Vite 或 localhost
- 结果仅保存在本机 `~/.xhs-simulator/`
- 发布包内置自包含 MCP 和预构建 Widget，无需安装 npm 或 Python 依赖

> 模拟结果用于发布前压力测试和观点探索，不代表真实市场预测。

## 安装

把本仓库注册为 Codex marketplace：

```bash
codex plugin marketplace add gizzap/xhs-simulator-codex --ref main
```

安装插件并确认状态：

```bash
codex plugin add xhs-simulator@xhs-simulator-github
codex plugin list
```

安装后完全退出并重新启动 Codex，然后新建任务并输入：

```text
打开小红书评论模拟器
```

## 更新

```bash
codex plugin marketplace upgrade xhs-simulator-github
codex plugin add xhs-simulator@xhs-simulator-github
```

更新后完全退出并重新启动 Codex。

## v0.2.0：复制与完整楼层

- 任意深度回复完整展示；只选中子回复时，不会因父楼未选中而丢失。
- 「复制全部」复制完整评论区；筛选态显示「复制筛选结果」，「复制选中」始终只复制命中的评论。
- 复制保留序号、原始楼层标签与原文，支持 Clipboard API 和旧式复制回退。
- 若宿主禁止自动复制，自动打开复制窗口；也可随时点「查看复制文本」→「全选文本」→ ⌘C / Ctrl+C。
- 粘贴表格时，在复制窗口开启「表格格式（每条一行）」，再复制。单条文案内的换行与制表符会转为空格，序号也能避免「+1」被当成公式。
- 通用人设库 60 人，路人注入支持 0/5/10/20/40；生成前执行首轮参与校准，后续允许重复参与与新人加入。

剪贴板权限由宿主决定，插件不会绕过权限。复制无需向 Codex 发送消息；开始模拟和智能挑选仍遵循宿主的消息确认规则。旧历史数据无需迁移。

## 工作方式

```text
Vue Widget → 当前 Codex 任务 → xhs-simulator Skill
      ↑                              ↓
      └──── 本地 MCP 读取/保存结果 ──┘
```

Widget 负责交互，Codex 根据 Skill 和本地人设完成模拟，本地 MCP 负责读取人设、保存结果和执行精确评论配比。

## 本地开发

```bash
npm install
npm --prefix web install
npm run quality
```

插件会提交 `mcp/generated/` 下的自包含发布产物。使用者不应在插件缓存目录中运行 `npm install`。

更多实现细节见 [Codex Widget 文档](docs/CODEX_WIDGET.md)。

## License

[MIT](LICENSE)
