"""Run the published HTML in an iframe with a local MCP Apps host fixture."""

import json
import re
import sys
from pathlib import Path

from playwright.sync_api import sync_playwright, expect


widget = Path(sys.argv[1] if len(sys.argv) > 1 else "mcp/generated/xhs-widget.html").resolve()
host = """
<iframe id="widget" sandbox="allow-scripts" style="width:1400px;height:900px;border:0"></iframe>
<script>
window.events = [];
const frame = document.querySelector('#widget');
addEventListener('message', event => {
  if (event.source !== frame.contentWindow || event.data?.jsonrpc !== '2.0') return;
  const { id, method, params } = event.data;
  events.push({ method, params });
  if (id === undefined) return;
  let result;
  if (method === 'ui/initialize') {
    result = {
      protocolVersion: params.protocolVersion,
      hostInfo: { name: 'XHS browser regression host', version: '1.0.0' },
      hostCapabilities: { serverTools: {}, message: { text: {} } },
      hostContext: {
        displayMode: 'inline', availableDisplayModes: ['inline', 'fullscreen'],
        containerDimensions: { width: 1400, height: 900 }
      }
    };
  } else if (method === 'ui/request-display-mode') {
    result = { mode: params.mode };
  } else if (method === 'tools/call') {
    let data;
    if (params.name === 'get_xhs_personas') {
      data = { personas: [{ id: 'browser-fixture', name: '浏览器测试人设', age: 30,
        city: '测试城市', occupation: '测试', tags: [], style: '理性',
        expressiveness: 0.8, always_active: true, has_samples: false }] };
    } else if (params.name === 'list_xhs_runs') {
      data = { runs: [] };
    } else if (params.name === 'get_xhs_run') {
      data = { status: 'pending' };
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
</script>
"""

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    try:
        page = browser.new_page(viewport={"width": 1440, "height": 940})
        errors = []
        page.on("pageerror", lambda error: errors.append(str(error)))
        page.on("console", lambda message: errors.append(message.text) if message.type == "error" else None)
        page.route("https://xhs-widget.test/", lambda route: route.fulfill(content_type="text/html; charset=utf-8", body=host))
        page.goto("https://xhs-widget.test/")
        if "--same-origin" in sys.argv:
            page.locator("iframe").evaluate("frame => frame.setAttribute('sandbox', 'allow-scripts allow-same-origin')")
        page.locator("iframe").evaluate("(frame, html) => frame.srcdoc = html", widget.read_text())
        page.wait_for_load_state("networkidle")
        ui = page.frame_locator("#widget")
        try:
            expect(ui.locator("textarea").first).to_be_visible(timeout=5000)
            expect(ui.get_by_text("浏览器测试人设", exact=True)).to_be_visible()
            ui.get_by_title("折叠人设列表", exact=True).click()
            ui.get_by_title("展开人设列表", exact=True).first.click()
            expect(ui.get_by_text("浏览器测试人设", exact=True)).to_be_visible()
            note = "这是一篇用于测试插件界面和消息交接的小红书笔记。"
            ui.locator("textarea").first.fill(note)
            start = ui.get_by_role("button", name="开始模拟", exact=True)
            expect(start).to_be_enabled()
            start.click()
            page.wait_for_function("events.some(e => e.method === 'ui/message')")
            events = page.evaluate("events")
            methods = [event["method"] for event in events]
            assert "ui/notifications/initialized" in methods
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
            print("PASS: iframe 可见、握手成功、人设加载、全屏请求和模拟消息交接均通过。")
        except Exception:
            print(f"FAIL: Widget 浏览器检查失败；脚本错误：{errors}")
            print(page.evaluate("events"))
            print(ui.locator("body").inner_text())
            raise
    finally:
        browser.close()
