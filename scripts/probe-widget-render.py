"""Run the published HTML in an iframe with a local MCP Apps host fixture."""

import json
import re
import sys
from pathlib import Path

from playwright.sync_api import sync_playwright, expect


widget = Path(next((arg for arg in sys.argv[1:] if not arg.startswith("--")), "mcp/generated/xhs-widget.html")).resolve()
note = "这是一篇用于测试插件界面和消息交接的小红书笔记。\n第二段正文保持原样。"
persona = {"id": "browser-fixture", "name": "浏览器测试人设", "age": 30,
           "city": "测试城市", "occupation": "测试", "tags": [], "style": "理性",
           "expressiveness": 0.8, "always_active": True, "has_samples": False}
run = {"status": "done", "run_id": "history-fixture", "timestamp": "2026-09-03T08:00:00",
       "model": "fixture", "note_text": note, "note_card": {"title": "测试笔记", "category": "测试", "tone": "分享"},
       "comments": [{"cid": 1, "persona": persona["id"], "persona_name": persona["name"],
                     "attitude": "观望", "text": "历史关联的测试评论", "parent": None, "round": 0, "likes": 1}]}
histories = [{"run_id": run_id, "timestamp": run["timestamp"], "category": "测试", "tone": "分享",
              "n_comments": 1, "summary": title} for run_id, title in
             [("history-fixture", "含完整原文的历史"), ("legacy-fixture", "未保存原文的旧历史")]]
host = """
<iframe id="widget" sandbox="allow-scripts" style="width:1400px;height:900px;border:0"></iframe>
<script>
window.events = [];
const frame = document.querySelector('#widget');
addEventListener('message', event => {
  if (event.source !== frame.contentWindow || event.data?.jsonrpc !== '2.0') return;
  const { id, method, params } = event.data;
  events.push({ method, params });
  if (method === 'ui/notifications/size-changed' && params.height > 0 && params.width > 0 && !window.waitingForResize) {
    frame.style.display = 'block';
    frame.style.height = params.height + 'px';
  }
  if (id === undefined) return;
  let result;
  if (method === 'ui/initialize') {
    result = {
      protocolVersion: params.protocolVersion,
      hostInfo: { name: 'XHS browser regression host', version: '1.0.0' },
      hostCapabilities: { serverTools: {}, message: { text: {} } },
      hostContext: {
        displayMode: window.initialDisplayMode || 'inline', availableDisplayModes: ['inline', 'fullscreen'],
        containerDimensions: { width: 1400, height: 900 }
      }
    };
  } else if (method === 'ui/request-display-mode') {
    if (window.stallDisplayMode) return;
    // Codex 先隐藏全屏容器，再由模式变化触发布局。相同模式不会触发布局。
    if (window.initialDisplayMode === 'fullscreen' && params.mode === 'fullscreen') {
      frame.style.display = 'none';
      window.waitingForResize = true;
    }
    result = { mode: params.mode };
  } else if (method === 'tools/call') {
    let data;
    if (params.name === 'get_xhs_personas') {
      data = { personas: [window.persona] };
    } else if (params.name === 'list_xhs_runs') {
      data = { runs: window.histories };
    } else if (params.name === 'get_xhs_run') {
      data = params.arguments.runId ? {...window.run} : { status: 'pending' };
      if (params.arguments.runId === 'legacy-fixture') delete data.note_text;
    } else {
      frame.contentWindow.postMessage({ jsonrpc: '2.0', id,
        error: { code: -32601, message: 'Unexpected tool' } }, '*');
      return;
    }
    result = { content: [], structuredContent: data };
  } else if (method === 'ui/message') {
    result = {};
  } else {
    frame.contentWindow.postMessage({ jsonrpc: '2.0', id,
      error: { code: -32601, message: 'Unexpected method' } }, '*');
    return;
  }
  frame.contentWindow.postMessage({ jsonrpc: '2.0', id, result }, '*');
});
addEventListener('resize', () => {
  if (window.waitingForResize) {
    window.waitingForResize = false;
    frame.style.display = 'block';
  }
});
</script>
"""

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    try:
        page = browser.new_page(viewport={"width": 1440, "height": 940})
        errors = []
        requests = []
        page.on("pageerror", lambda error: errors.append(str(error)))
        page.on("console", lambda message: errors.append(message.text) if message.type == "error" else None)
        standalone = "--standalone" in sys.argv

        def api(route):
            path = route.request.url.split("/api/", 1)[1]
            if path.startswith("personas"):
                data = {"personas": [persona]}
            elif path == "runs":
                data = {"runs": histories}
            elif path == "simulate":
                requests.append(route.request.post_data_json)
                data = {"run_id": run["run_id"]}
            elif path.endswith("/status"):
                data = {"status": "done"}
            elif path in ("runs/history-fixture", "runs/legacy-fixture"):
                data = dict(run)
                if path == "runs/legacy-fixture":
                    data.pop("note_text")
            else:
                raise AssertionError(f"Unexpected API request: {path}")
            route.fulfill(json=data)

        page.route("https://xhs-widget.test/api/**", api)
        page.route("https://xhs-widget.test/", lambda route: route.fulfill(content_type="text/html; charset=utf-8", body=widget.read_text() if standalone else host))
        page.goto("https://xhs-widget.test/")
        page.evaluate("([persona, run, histories, stall]) => Object.assign(window, {persona, run, histories, stallDisplayMode: stall})",
                      [persona, run, histories, "--stalled-fullscreen" in sys.argv])
        if "--hidden" in sys.argv and not standalone:
            page.locator("iframe").evaluate("frame => frame.style.display = 'none'")
        if "--same-origin" in sys.argv and not standalone:
            page.locator("iframe").evaluate("frame => frame.setAttribute('sandbox', 'allow-scripts allow-same-origin')")
        if not standalone:
            page.locator("iframe").evaluate("(frame, html) => frame.srcdoc = html", widget.read_text())
        page.wait_for_load_state("networkidle")
        ui = page if standalone else page.frame_locator("#widget")
        try:
            expect(ui.locator("textarea").first).to_be_visible(timeout=5000)
            expect(ui.get_by_title("展开人设列表", exact=True)).to_be_visible()
            ui.get_by_title("展开人设列表", exact=True).click()
            expect(ui.get_by_text("浏览器测试人设", exact=True)).to_be_visible()
            ui.get_by_title("折叠人设列表", exact=True).click()
            ui.get_by_title("展开人设列表", exact=True).first.click()
            expect(ui.get_by_text("浏览器测试人设", exact=True)).to_be_visible()
            ui.locator("textarea").first.fill("加载历史前尚未提交的正文")
            ui.get_by_role("button", name="生成历史").click()
            ui.get_by_text("含完整原文的历史", exact=True).click()
            expect(ui.locator("textarea").first).to_have_value(note)
            expect(ui.get_by_text("历史关联的测试评论", exact=True)).to_be_visible()
            if "--reopen" in sys.argv and not standalone:
                for _ in range(3):
                    page.evaluate("""() => {
                        window.events = [];
                        window.initialDisplayMode = 'fullscreen';
                        window.waitingForResize = false;
                        document.querySelector('#widget').style.display = 'none';
                    }""")
                    # 侧窗保持相同大小重挂载 Widget，不触发宿主窗口 resize。
                    page.locator("iframe").evaluate("(frame, html) => frame.srcdoc = html", widget.read_text())
                    page.wait_for_load_state("networkidle")
                    expect(ui.locator("textarea").first).to_be_visible(timeout=2000)
                    page.wait_for_function("events.some(e => e.method === 'tools/call' && e.params.name === 'list_xhs_runs')")
                    assert not page.evaluate("events.some(e => e.method === 'ui/request-display-mode')"), "已是全屏时不得重复请求"
                    assert not page.evaluate("waitingForResize"), "重开不能依赖用户调整窗口大小"
                print("PASS: 相同尺寸连续重开三次，未重复请求全屏，无需用户 resize 即可显示。")
            ui.get_by_role("button", name="生成历史").click()
            ui.get_by_text("未保存原文的旧历史", exact=True).click()
            expect(ui.locator("textarea").first).to_have_value("")
            expect(ui.get_by_text("这条历史未保存笔记原文，请重新粘贴正文。", exact=True)).to_be_visible()
            ui.locator("textarea").first.fill(note)
            start = ui.get_by_role("button", name="开始模拟", exact=True)
            expect(start).to_be_enabled()
            start.click()
            if standalone:
                expect(ui.get_by_text("完成 · 1 条评论", exact=True)).to_be_visible()
                assert requests[0]["note_text"] == note
                assert requests[0]["persona_ids"] == ["browser-fixture"]
                assert not errors, errors
                print("PASS: 独立模式默认收起、恢复历史正文、旧记录提示和模拟 API 均通过。")
                sys.exit(0)
            page.wait_for_function("events.some(e => e.method === 'ui/message')")
            events = page.evaluate("events")
            methods = [event["method"] for event in events]
            assert "ui/notifications/initialized" in methods
            if "--reopen" not in sys.argv:
                assert "ui/request-display-mode" in methods
            tools = {event["params"]["name"] for event in events if event["method"] == "tools/call"}
            assert {"get_xhs_personas", "list_xhs_runs"}.issubset(tools)
            message = next(event["params"]["content"][0]["text"] for event in events if event["method"] == "ui/message")
            assert message.startswith("XHS_WIDGET_SIMULATE\n")
            payload = json.loads(re.search(r"参数 JSON：\n([^\n]+)", message).group(1))
            assert payload["note_text"] == note
            assert payload["settings"]["persona_ids"] == ["browser-fixture"]
            assert payload["request_id"].startswith("simulate-")
            assert not errors, errors
            print("PASS: iframe 首屏可见、默认收起、人设加载、历史正文恢复、旧记录提示和模拟消息交接均通过。")
        except Exception:
            print(f"FAIL: Widget 浏览器检查失败；脚本错误：{errors}")
            print(page.evaluate("events"))
            print(ui.locator("#app").text_content()[:2000])
            raise
    finally:
        browser.close()
