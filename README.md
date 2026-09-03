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
```

更新后完全退出并重新启动 Codex。

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
npm run quality
```

插件会提交 `mcp/generated/` 下的自包含发布产物。使用者不应在插件缓存目录中运行 `npm install`。

更多实现细节见 [Codex Widget 文档](docs/CODEX_WIDGET.md)。

## License

[MIT](LICENSE)
