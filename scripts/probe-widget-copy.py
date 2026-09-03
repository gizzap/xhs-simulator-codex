"""Verify the shipped widget with a protocol host and real clipboard paste.

No model calls or user data. Requires Python Playwright and Chromium.
"""
import json
import re
import sys
from pathlib import Path

from playwright.sync_api import expect, sync_playwright

ROOT = Path(__file__).resolve().parent.parent
COMMENTS = [dict(cid=i, persona=f"p{i}", persona_name=f"测试人设{i}",
                 text=f"测试评论{i}" if i != 18 else "+1\n补充一行\t内容",
                 parent=i - 1 if 2 <= i <= 4 else None,
                 round=0 if i == 1 or i > 4 else i - 1,
                 attitude="观望", likes=0, source="target") for i in range(1, 19)]
RUN = dict(status="done", run_id="copy-fixture", timestamp="2026-09-03T00:00:00Z",
           model="fixture", note_card=dict(category="测试", tone="测试"), comments=COMMENTS)
HOST = """<!doctype html><meta charset="utf-8">
<textarea id="paste" aria-label="粘贴验证"></textarea>
<iframe id="widget" sandbox="allow-scripts allow-same-origin" allow="clipboard-write" style="width:1600px;height:950px"></iframe>
<script>
window.events = [];
const fixture = __FIXTURE__;
const frame = document.querySelector('#widget');
addEventListener('message', event => {
  if (event.source !== frame.contentWindow || event.data?.jsonrpc !== '2.0') return;
  const {id, method, params} = event.data;
  events.push({method, params});
  if (id === undefined) return;
  let result;
  if (method === 'ui/initialize') result = {
    protocolVersion: params.protocolVersion,
    hostInfo: {name:'Clipboard regression host', version:'1.0.0'},
    hostCapabilities: {serverTools:{}, message:{text:{}}},
    hostContext: {displayMode:'inline', availableDisplayModes:['inline','fullscreen'], containerDimensions:{width:1600,height:950}}
  };
  else if (method === 'ui/request-display-mode') result = {mode: params.mode};
  else if (method === 'ui/message') result = {};
  else if (method === 'tools/call') {
    let data;
    if (params.name === 'get_xhs_personas') data = {personas:[{id:'p1',name:'测试人设',tags:[],style:'测试'}]};
    else if (params.name === 'list_xhs_runs') data = {runs:[{run_id:'copy-fixture',summary:'复制回归测试',n_comments:18,timestamp:fixture.timestamp}]};
    else if (params.name === 'get_xhs_run') data = fixture;
    else if (params.name === 'get_xhs_selection') data = {status:'done',selected:[4,18],summary:'只选深层回复和末条'};
    else throw Error('Unexpected tool: '+params.name);
    result = {content:[],structuredContent:data};
  } else throw Error('Unexpected method: '+method);
  frame.contentWindow.postMessage({jsonrpc:'2.0',id,result},'*');
});
</script>""".replace("__FIXTURE__", json.dumps(RUN, ensure_ascii=False))


def copy_text(ids, single_line=False):
    rows = []
    for index, cid in enumerate(ids, 1):
        tag = "[主楼]" if cid in (1, 18) else ("[楼" + "中楼" * (cid - 1) + "]" if 2 <= cid <= 4 else "")
        text = COMMENTS[cid - 1]["text"]
        if single_line:
            text = text.replace("\n", " ").replace("\t", " ")
        rows.append(f"{index}.{tag}{text}")
    return "\n".join(rows)


def assert_paste(page, expected):
    destination = page.locator("#paste")
    destination.fill("")
    destination.focus()
    page.keyboard.press("Meta+V" if sys.platform == "darwin" else "Control+V")
    expect(destination).to_have_value(expected)


def standalone_api(route):
    path = route.request.url.split("/api/", 1)[1]
    if path.startswith("personas"):
        data = {"personas": [dict(id="p1", name="测试人设", tags=[], style="测试")]}
    elif path == "runs":
        data = {"runs": [dict(run_id="copy-fixture", summary="复制回归测试", n_comments=18, timestamp=RUN["timestamp"])]}
    elif path == "runs/copy-fixture":
        data = RUN
    elif path == "select":
        data = dict(selected=[4, 18], summary="只选深层回复和末条")
    else:
        raise AssertionError(f"Unexpected standalone request: {path}")
    route.fulfill(json=data)


with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    try:
        for mode in ["clipboard", "legacy", "manual", "opaque", "standalone"]:
            context = browser.new_context(viewport={"width": 1680, "height": 1100})
            if mode in ["clipboard", "standalone"]:
                # Model a host that honors ui.permissions.clipboardWrite.
                context.grant_permissions(["clipboard-read", "clipboard-write"])
            page = context.new_page()
            errors = []
            page.on("pageerror", lambda e: errors.append(str(e)))
            page.route("https://xhs-host.test/", lambda route: route.fulfill(content_type="text/html", body=html if mode == "standalone" else HOST))
            page.route("https://xhs-host.test/api/**", standalone_api)
            html = (ROOT / "mcp/generated/xhs-widget.html").read_text()
            page.route("https://xhs-widget.test/", lambda route: route.fulfill(content_type="text/html", body=html))
            page.goto("https://xhs-host.test/")
            if mode == "opaque":
                page.locator("iframe").evaluate("f => f.setAttribute('sandbox','allow-scripts')")
            if mode in ["legacy", "manual"]:
                page.locator("iframe").evaluate("f => f.setAttribute('allow', \"clipboard-write 'none'\")")
            if mode == "standalone":
                page.evaluate("""() => {
                    const paste = document.createElement('textarea');
                    paste.id = 'paste';
                    paste.style = 'position:fixed;top:0;right:0;width:80px;height:24px;z-index:200';
                    document.body.appendChild(paste);
                }""")
                ui = page
            else:
                page.locator("iframe").evaluate("f => f.src='https://xhs-widget.test/'")
                ui = page.frame_locator("#widget")
            ui.get_by_role("button", name="生成历史", exact=True).click()
            ui.get_by_text("复制回归测试", exact=True).click()
            expect(ui.locator("span").filter(has_text=re.compile(r"^#\d+$"))).to_have_count(18)
            frame = page.main_frame if mode == "standalone" else page.frames[1]
            if mode == "clipboard":
                # Force this case to use the real Clipboard API, not execCommand.
                frame.evaluate("""() => {
                    document.execCommand = () => false;
                    const write = navigator.clipboard.writeText.bind(navigator.clipboard);
                    navigator.clipboard.writeText = async text => {
                        try { await write(text); }
                        catch(e) { console.log('Clipboard failure: '+e.name+': '+e.message); throw e; }
                    };
                }""")
                page.on("console", lambda message: print(message.text) if "Clipboard failure" in message.text else None)
            if mode == "manual":
                frame.evaluate("document.execCommand = () => false")

            ui.get_by_role("button", name="复制全部", exact=True).click()
            if mode == "manual":
                expect(ui.get_by_role("dialog")).to_be_visible()
                expect(ui.get_by_label("待复制评论")).to_have_value(copy_text(range(1, 19)))
                ui.get_by_role("button", name="全选文本", exact=True).click()
                page.keyboard.press("Meta+C" if sys.platform == "darwin" else "Control+C")
                assert_paste(page, copy_text(range(1, 19)))
                ui.get_by_role("dialog").press("Escape")
            else:
                expect(ui.get_by_text("复制成功：18 条文案", exact=True)).to_be_visible()
                assert_paste(page, copy_text(range(1, 19)))

            ui.get_by_placeholder("例如：挑出最适合做置顶评论的 5 条 / 选出让品牌方最紧张的质疑评论 / 挑出宝妈们最关心的问题整理成 FAQ").fill("只挑选深层回复和末条")
            ui.get_by_role("button", name="挑选", exact=True).click()
            expect(ui.locator("[data-comment-id]")).to_have_count(2)
            expect(ui.locator('[data-comment-id="4"]')).to_be_visible()
            ui.get_by_role("button", name="查看复制文本", exact=True).click()
            expect(ui.get_by_label("待复制评论")).to_have_value(copy_text([4, 18]))
            ui.get_by_role("switch", name="表格格式（每条一行）", exact=True).click()
            expect(ui.get_by_label("待复制评论")).to_have_value(copy_text([4, 18], True))
            ui.get_by_role("button", name="全选文本", exact=True).click()
            page.keyboard.press("Meta+C" if sys.platform == "darwin" else "Control+C")
            if mode == "standalone":
                # The same-page dialog traps focus; close it before pasting outside.
                ui.get_by_role("dialog").press("Escape")
            assert_paste(page, copy_text([4, 18], True))
            if mode != "standalone":
                ui.get_by_role("dialog").press("Escape")
            ui.get_by_role("button", name="显示全部", exact=True).click()
            expect(ui.locator("[data-comment-id]")).to_have_count(18)
            ui.get_by_role("button", name="复制选中", exact=True).click()
            if mode == "manual":
                expect(ui.get_by_label("待复制评论")).to_have_value(copy_text([4, 18], True))
            else:
                expect(ui.get_by_text("复制成功：2 条文案", exact=True)).to_be_visible()
                assert_paste(page, copy_text([4, 18], True))
            assert not errors, errors
            print(f"PASS {mode}: 18 条完整显示/复制，孤立深层筛选、表格格式与实际键盘粘贴。")
            context.close()
    finally:
        browser.close()
