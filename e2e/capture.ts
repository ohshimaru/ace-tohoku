/**
 * 閲覧用プレビューの素材取り込み: デモデータ入りの本番ビルドを起動し、各画面のHTMLとCSSを保存する。
 *   pnpm build && pnpm exec tsx e2e/capture.ts <出力JSON>（DATABASE_URL はデモデータ入りのDB）
 */
import "dotenv/config";
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import * as cheerio from "cheerio";
type AnyNode = { type: string; next: AnyNode | null };
import { Browser } from "./client";

const PORT = 3102;
const BASE = `http://localhost:${PORT}`;

type Shot = { role: string; path: string; title: string; body: string };

/** React のストリーミング（読込中→本体）を、JavaScriptなしで本体に差し替える */
function resolveStreaming($: cheerio.CheerioAPI, html: string) {
  // $RC("B:0","S:0")（読込中枠の置換）と $RS("S:1","P:1")（部分の置換）の対応を読む
  const pairs: [string, string][] = [];
  for (const m of html.matchAll(/\$RC\("([^"]+)","([^"]+)"\)/g)) pairs.push([m[2], m[1]]);
  for (const m of html.matchAll(/\$RS\("([^"]+)","([^"]+)"\)/g)) pairs.push([m[1], m[2]]);
  for (const [segId, targetId] of pairs) {
    const seg = $(`div[hidden][id='${segId}']`);
    const tpl = $(`template[id='${targetId}']`);
    if (!seg.length || !tpl.length) continue;
    if (targetId.startsWith("B:")) {
      // template の後ろから <!--/$--> までの読込中表示を削除
      let n: AnyNode | null = tpl[0].next;
      while (n && !(n.type === "comment" && (n as unknown as { data: string }).data === "/$")) {
        const next: AnyNode | null = n.next;
        $(n as never).remove();
        n = next;
      }
    }
    tpl.replaceWith(seg.html() ?? "");
    seg.remove();
  }
  $("script, noscript, link, template").remove();
  $("next-route-announcer").remove();
}

async function demo(b: Browser, name: string, path: string) {
  const p = await b.get(path);
  const btn = p.$("button[type=submit]").toArray().map((e) => p.$(e).text().trim()).find((t) => t.startsWith(name));
  if (!btn) throw new Error(`no demo button ${name}`);
  await b.submit(p, btn);
}

async function main() {
  const out = process.argv[2] ?? "capture.json";
  const server = spawn("pnpm", ["exec", "next", "start", "-p", String(PORT)], { env: { ...process.env, APP_URL: BASE, DEMO_LOGIN: "true", DEMO_ENVIRONMENT: "true", NODE_ENV: "production" }, stdio: ["ignore", "ignore", "inherit"] });
  const shots: Shot[] = [];
  let css = "";
  try {
    for (let i = 0; i < 60; i++) {
      try { if ((await fetch(`${BASE}/login`)).ok) break; } catch {}
      await new Promise((r) => setTimeout(r, 500));
    }
    const anon = new Browser(BASE);
    const login = await anon.get("/login");
    const cssHref = login.$("link[rel=stylesheet]").attr("href")!;
    css = await (await fetch(new URL(cssHref, BASE))).text();
    const take = async (b: Browser, role: string, path: string) => {
      const p = await b.get(path);
      const $ = cheerio.load(p.html);
      const title = $("title").text();
      resolveStreaming($, p.html);
      shots.push({ role, path, title, body: $("body").html() ?? "" });
      return cheerio.load($.html());
    };
    await take(anon, "guest", "/login");
    await take(anon, "guest", "/d/login");
    const roles: [string, string, string, string[], string[]][] = [
      ["owner", "代表 太郎（デモ）", "/login", ["/app", "/app/actions", "/app/divisions", "/app/pl", "/app/budget", "/app/sales", "/app/expenses", "/app/approvals", "/app/payables", "/app/bank", "/app/months", "/app/partners", "/app/projects", "/app/contracts", "/app/contracts/templates", "/app/drivers", "/app/shifts", "/app/reports", "/app/statements", "/app/statements/rates", "/app/reminders", "/app/cleanup", "/app/settings", "/app/audit"], ["/app/divisions/", "/app/contracts/", "/app/statements/", "/app/drivers/", "/app/bank/", "/app/reports/", "/app/expenses/", "/app/sales/"]],
      ["manager", "SNS 責任者（デモ）", "/login", ["/app", "/app/pl", "/app/expenses", "/app/bank"], []],
      ["driver", "高橋 三郎（デモ）", "/d/login", ["/d", "/d/availability", "/d/schedule", "/d/reports", "/d/reports/new", "/d/more", "/d/statements", "/d/expenses", "/d/expenses/new", "/d/profile", "/d/contracts"], ["/d/statements/", "/d/reports/"]],
    ];
    for (const [role, name, lp, paths, prefixes] of roles) {
      const b = new Browser(BASE);
      await demo(b, name, lp);
      const details = new Set<string>();
      for (const path of paths) {
        const $ = await take(b, role, path);
        for (const prefix of prefixes) {
          $(`a[href^='${prefix}']`).slice(0, 2).each((_, a) => {
            const h = $(a).attr("href")!;
            if (!h.endsWith("/new") && !h.includes("/rates") && !h.includes("/templates")) details.add(h);
          });
        }
      }
      for (const d of details) if (!shots.some((s) => s.role === role && s.path === d)) await take(b, role, d);
    }
  } finally {
    server.kill("SIGTERM");
  }
  writeFileSync(out, JSON.stringify({ css, shots }));
  console.log(`取り込み: ${shots.length} 画面, CSS ${css.length} bytes`);
}
main();
