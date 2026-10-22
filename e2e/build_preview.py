"""取り込んだ画面を、閲覧専用のプレビューページ1枚にまとめる。
使い方: python3 e2e/build_preview.py <capture.json> <稼働明細PDF.png> <契約書PDF.png> <出力.html>
"""
import base64
import html
import json
import re
import sys
from urllib.parse import urlparse

cap = json.load(open(sys.argv[1]))
pdf_png = base64.b64encode(open(sys.argv[2], "rb").read()).decode()
ct_png = base64.b64encode(open(sys.argv[3], "rb").read()).decode()
out = sys.argv[4]

ROLE_LABEL = {"owner": "経営者（全権限）", "manager": "SNS事業部の責任者", "driver": "業務委託ドライバー（スマホ）", "guest": "ログイン前"}
ROLE_PREFIX = {"owner": "o", "manager": "m", "driver": "d", "guest": "g"}

shots = cap["shots"]
tokens = {}
counter = {}
for s in shots:
    path = s["path"]
    base = urlparse(path).path.strip("/").replace("/", "-") or "home"
    base = re.sub(r"-[0-9a-f]{8}-[0-9a-f-]{27}$", "", base)  # UUIDを短く
    q = urlparse(path).query
    m = re.search(r"kind=([A-Za-z]+)", q)
    if m:
        base += "-" + m.group(1)
    key = f"{ROLE_PREFIX[s['role']]}-{base}"
    counter[key] = counter.get(key, 0) + 1
    tokens[(s["role"], path)] = key if counter[key] == 1 else f"{key}{counter[key]}"


def label_of(s):
    t = s["title"].split("|")[0].strip()
    if t in ("経営ナビ", "BackOffice Hub") or not t or s["path"].count("/") > 2:
        # 詳細画面はページ見出しを使う
        m = re.search(r"<h1[^>]*>(.*?)</h1>", s["body"], re.S)
        t = re.sub(r"<[^>]+>", "", m.group(1)).strip() if m else s["path"]
    return html.unescape(t)


def find_target(role, href):
    if "/api/export/statement" in href and "pdf" in href:
        return "x-statement-pdf"
    if "/api/export/contract" in href:
        return "x-contract-pdf"
    for (r, p), tok in tokens.items():
        if r == role and p == href:
            return tok
    path = urlparse(href).path
    for (r, p), tok in tokens.items():
        if r == role and urlparse(p).path == path:
            return tok
    return None


def rewrite(s):
    body = s["body"]

    def repl(m):
        href = html.unescape(m.group(2))
        if href.startswith("http"):
            return m.group(0)
        tok = find_target(s["role"], href)
        if tok:
            return f'{m.group(1)}href="#{tok}" data-to="{tok}"'
        return f'{m.group(1)}href="#" data-missing="1"'

    body = re.sub(r'(<a\b[^>]*?\s)href="([^"]*)"', repl, body)
    body = re.sub(r"<form\b", '<form data-preview="1"', body)
    return body


sections = []
options = {"owner": [], "manager": [], "driver": [], "guest": []}
for s in shots:
    tok = tokens[(s["role"], s["path"])]
    options[s["role"]].append((tok, label_of(s)))
    sections.append(f'<section class="pv-screen" id="{tok}" data-role="{s["role"]}" hidden>{rewrite(s)}</section>')

def pdf_sec(tok, role, note, alt, png):
    return (f'<section class="pv-screen" id="{tok}" data-role="{role}" hidden>'
            f'<div class="pv-pdf"><p class="pv-pdf-note">{note}</p>'
            f'<img alt="{alt}" src="data:image/png;base64,{png}"></div></section>')
sections.append(pdf_sec("x-statement-pdf", "owner", "稼働明細PDF（デモデータから実際に出力したものを画像化）", "稼働明細PDFの1ページ目", pdf_png))
sections.append(pdf_sec("x-contract-pdf", "owner", "契約書PDF（ひな形テンプレートに差し込んだもの。締結前は透かし入り）", "契約書PDFの1ページ目", ct_png))
options["owner"].append(("x-statement-pdf", "稼働明細PDF（出力例）"))
options["owner"].append(("x-contract-pdf", "契約書PDF（出力例）"))


def opts(role):
    seen = set()
    rows = []
    for tok, lab in options[role]:
        if tok in seen:
            continue
        seen.add(tok)
        rows.append(f'<option value="{tok}">{html.escape(lab)}</option>')
    return "".join(rows)


banner = f"""
<div class="pv-bar" role="region" aria-label="プレビューの操作">
  <div class="pv-bar-in">
    <p class="pv-badge">閲覧用プレビュー</p>
    <p class="pv-text">デモデータ（架空）を入れた実際のアプリの画面です。保存・承認・提出などの操作はこのページでは行えません。</p>
    <label class="pv-pick" for="pv-select">画面
      <select id="pv-select">
        <optgroup label="経営者（全権限）">{opts("owner")}</optgroup>
        <optgroup label="SNS事業部の責任者（権限の違い）">{opts("manager")}</optgroup>
        <optgroup label="業務委託ドライバー（スマホ画面）">{opts("driver")}</optgroup>
        <optgroup label="ログイン前">{opts("guest")}</optgroup>
      </select>
    </label>
  </div>
</div>
<div class="pv-toast" id="pv-toast" role="status" aria-live="polite" hidden></div>
"""

style = """
:root { color-scheme: light; --pv-ink: #0e1628; --pv-bar: #16223c; --pv-bar-fg: #e3e9f3; --pv-accent: #f0b429; --pv-line: #344f81; }
body { background: #f5f7fb; }
.pv-bar { background: var(--pv-bar); color: var(--pv-bar-fg); border-bottom: 1px solid var(--pv-line); }
.pv-bar-in { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 16px; padding-block: 10px;
  padding-left: max(16px, env(safe-area-inset-left, 0px)); padding-right: max(16px, env(safe-area-inset-right, 0px)); }
.pv-badge { margin: 0; background: var(--pv-accent); color: var(--pv-ink); font-weight: 700; font-size: 12px; padding: 2px 8px; border-radius: 4px; letter-spacing: .04em; }
.pv-text { margin: 0; font-size: 12px; flex: 1 1 280px; min-width: 0; }
.pv-pick { display: flex; align-items: center; gap: 8px; font-size: 12px; font-weight: 700; }
.pv-pick select { min-height: 36px; max-width: min(320px, 70vw); border-radius: 6px; border: 1px solid var(--pv-line); background: #ffffff; color: var(--pv-ink); padding: 0 8px; font-size: 14px; }
.pv-toast { position: fixed; left: 50%; transform: translateX(-50%); bottom: calc(76px + env(safe-area-inset-bottom, 0px)); z-index: 60;
  background: var(--pv-ink); color: #ffffff; font-size: 13px; padding: 10px 14px; border-radius: 8px; max-width: calc(100vw - 32px); box-shadow: 0 6px 20px rgba(0,0,0,.25); }
.pv-pdf { max-width: 760px; margin: 24px auto; padding-left: max(16px, env(safe-area-inset-left, 0px)); padding-right: max(16px, env(safe-area-inset-right, 0px)); }
.pv-pdf img { width: 100%; border: 1px solid #dfe5ee; box-shadow: 0 2px 12px rgba(16,24,40,.12); background: #ffffff; }
.pv-pdf-note { font-size: 13px; color: #5b6678; }
/* プレビューでは動かないボタン（スマホのメニュー開閉）は隠す */
button[aria-label="メニューを開く"] { visibility: hidden; }
.pv-screen[data-role="driver"] .fixed { position: sticky; }
.pv-screen .lg\\:h-screen { top: 0; }
"""

script = """
(function () {
  var screens = Array.prototype.slice.call(document.querySelectorAll('.pv-screen'));
  var select = document.getElementById('pv-select');
  var toast = document.getElementById('pv-toast');
  var timer;
  function say(msg) {
    toast.textContent = msg; toast.hidden = false;
    clearTimeout(timer); timer = setTimeout(function () { toast.hidden = true; }, 3200);
  }
  function show(tok) {
    var found = false;
    screens.forEach(function (s) { var on = s.id === tok; s.hidden = !on; if (on) found = true; });
    if (!found) { screens[1].hidden = false; tok = screens[1].id; }
    select.value = tok;
    window.scrollTo(0, 0); setTimeout(function () { window.scrollTo(0, 0); }, 0);
  }
  select.addEventListener('change', function () { show(select.value); try { history.replaceState(null, '', '#' + select.value); } catch (e) {} });
  document.addEventListener('click', function (e) {
    var a = e.target.closest && e.target.closest('a');
    if (a && a.dataset.to) { e.preventDefault(); show(a.dataset.to); try { history.replaceState(null, '', '#' + a.dataset.to); } catch (err) {} return; }
    if (a && a.dataset.missing) { e.preventDefault(); say('この画面はプレビューに含まれていません'); return; }
    var b = e.target.closest && e.target.closest('button');
    if (b && b.closest('.pv-screen')) { e.preventDefault(); say('プレビューのため、この操作（' + b.textContent.trim() + '）は実行されません'); }
  });
  document.addEventListener('submit', function (e) { e.preventDefault(); }, true);
  var initial = (location.hash || '').slice(1);
  show(initial && document.getElementById(initial) ? initial : 'o-app');
})();
"""

page = (
    "<title>経営ナビ デモ</title>\n"
    f"<style>{cap['css']}\n{style}</style>\n"
    f"{banner}\n" + "\n".join(sections) + f"\n<script>{script}</script>\n"
)
open(out, "w").write(page)
print(f"{out}: {len(page)//1024} KB, {len(sections)} screens")
