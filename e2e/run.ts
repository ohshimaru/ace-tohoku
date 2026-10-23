/**
 * 受入シナリオのE2E検証（本番ビルドを起動し、HTTPで画面を操作）
 *   pnpm build && pnpm test:e2e
 * 専用DB（E2E_DATABASE_URL）を毎回作り直し、初期データ・デモデータを入れて検証します。
 * 本番ビルドで動かすため、デモログインは「デモ環境」設定（DEMO_ENVIRONMENT=true）で有効にしています。
 */
import "dotenv/config";
import { type ChildProcess, spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Pool } from "pg";
import { Browser, type Page, text } from "./client";

const PORT = 3100;
const BASE = `http://localhost:${PORT}`;
const DB_URL = process.env.E2E_DATABASE_URL ?? "postgresql://postgres@localhost:5432/ace_e2e";
if (DB_URL === process.env.DATABASE_URL) throw new Error("E2E_DATABASE_URL に本番・開発DBと同じものは指定できません");
const CRON = "e2e-cron-secret-0123456789";

let passed = 0;
const failures: string[] = [];
function check(name: string, ok: boolean, detail = "") {
  if (ok) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failures.push(`${name} ${detail}`);
    console.log(`  ✗ ${name} ${detail}`);
  }
}
const has = (p: Page, s: string) => text(p).includes(s);
const notice = (p: Page) => p.$("[role=status], [role=alert]").map((_, e) => p.$(e).text().trim()).get().join(" / ");

function run(cmd: string, args: string[], env: Record<string, string>) {
  return new Promise<void>((resolve, reject) => {
    const c = spawn(cmd, args, { env: { ...process.env, ...env }, stdio: "inherit" });
    c.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} ${args.join(" ")} exited ${code}`))));
  });
}

async function resetDb() {
  const pool = new Pool({ connectionString: DB_URL });
  await pool.query("drop schema if exists public cascade; drop schema if exists drizzle cascade; create schema public;");
  await pool.end();
}

async function q<T>(sqlText: string, params: unknown[] = []): Promise<T[]> {
  const pool = new Pool({ connectionString: DB_URL });
  try {
    return (await pool.query(sqlText, params)).rows as T[];
  } finally {
    await pool.end();
  }
}

async function waitReady() {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`${BASE}/login`);
      if (r.status === 200) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("サーバーが起動しませんでした");
}

async function main() {
  const storage = mkdtempSync(path.join(os.tmpdir(), "ace-e2e-"));
  const env = { DATABASE_URL: DB_URL, MIGRATE_DATABASE_URL: DB_URL, STORAGE_DRIVER: "local", STORAGE_DIR: storage, APP_URL: BASE, EMAIL_DRIVER: "console", DEMO_LOGIN: "true", DEMO_ENVIRONMENT: "true", DEMO_SEED_ALLOW: "yes", CRON_SECRET: CRON, LINE_CHANNEL_ID: "", LINE_CHANNEL_SECRET: "", ANTHROPIC_API_KEY: "" };
  console.log("● DBを初期化し、マイグレーション・初期データ・デモデータを投入");
  await resetDb();
  await run("pnpm", ["-s", "db:migrate"], env);
  await run("pnpm", ["-s", "db:seed"], env);
  await run("pnpm", ["-s", "db:seed-demo"], { ...env, NODE_ENV: "production" });
  console.log("● 本番ビルドを起動");
  const server: ChildProcess = spawn("pnpm", ["exec", "next", "start", "-p", String(PORT)], { env: { ...process.env, ...env, NODE_ENV: "production" }, stdio: ["ignore", "ignore", "inherit"] });
  try {
    await waitReady();
    await scenario();
  } finally {
    server.kill("SIGTERM");
  }
  console.log(`\n結果: ${passed} 件成功 / ${failures.length} 件失敗`);
  if (failures.length) {
    failures.forEach((f) => console.log(`  - ${f}`));
    process.exitCode = 1;
  }
}

async function demoLogin(b: Browser, name: string, path = "/login") {
  const p = await b.get(path);
  const btn = p.$("button[type=submit]").toArray().map((e) => p.$(e).text().trim()).find((t) => t.startsWith(name));
  if (!btn) throw new Error(`デモログインのボタンがありません: ${name}`);
  return b.submit(p, btn);
}

const STAFF_PAGES = ["/app", "/app/tasks", "/app/guide", "/app/actions", "/app/divisions", "/app/pl", "/app/budget", "/app/sales", "/app/expenses", "/app/approvals", "/app/payables", "/app/bank", "/app/months", "/app/partners", "/app/projects", "/app/contracts", "/app/contracts/templates", "/app/drivers", "/app/shifts", "/app/reports", "/app/statements", "/app/statements/rates", "/app/reminders", "/app/cleanup", "/app/settings", "/app/audit"];
const DRIVER_PAGES = ["/d", "/d/availability", "/d/schedule", "/d/reports", "/d/reports/new", "/d/more", "/d/expenses", "/d/expenses/new", "/d/statements", "/d/profile", "/d/contracts", "/d/finance"];

async function scenario() {
  const [cur] = (await q<{ m: string }>("select to_char(now() at time zone 'Asia/Tokyo', 'YYYY-MM') m")).map((r) => r.m);
  const [next] = (await q<{ m: string }>("select to_char((now() at time zone 'Asia/Tokyo') + interval '1 month', 'YYYY-MM') m")).map((r) => r.m);
  const [prev] = (await q<{ m: string }>("select to_char((now() at time zone 'Asia/Tokyo') - interval '1 month', 'YYYY-MM') m")).map((r) => r.m);

  console.log("● 1. すべての画面が表示できる（経営者）");
  const owner = new Browser(BASE);
  await demoLogin(owner, "代表 太郎（デモ）");
  for (const path of STAFF_PAGES) {
    const p = await owner.get(path);
    check(`経営者 ${path}`, p.status === 200 && !has(p, "処理に失敗しました") && !has(p, "Application error"), `status=${p.status}`);
  }
  const dash = await owner.get("/app");
  check("ダッシュボードにデモ表示", has(dash, "デモデータ（架空）"));
  check("ダッシュボードにAI行動カード", has(dash, "根拠") || has(dash, "対応"));
  const divs = await q<{ id: string; code: string }>("select id, code from division");
  for (const d of divs) {
    const p = await owner.get(`/app/divisions/${d.id}`);
    check(`事業部画面 ${d.code}`, p.status === 200 && !has(p, "Application error"));
  }

  console.log("● 2. 権限の分離");
  const sns = new Browser(BASE);
  await demoLogin(sns, "SNS 責任者（デモ）");
  const bankDenied = await sns.get("/app/bank");
  check("事業部責任者は入出金を見られない", has(bankDenied, "権限がありません"));
  const drvList = await sns.get("/app/drivers");
  check("SNS責任者には業務委託のドライバーが見えない", !has(drvList, "佐藤 一郎"));
  const [stmt] = await q<{ id: string; driver_id: string }>("select id, driver_id from statement where status = 'PUBLISHED' order by id limit 1");
  const snsStmt = await sns.get(`/app/statements/${stmt.id}`);
  // 読み込み表示の後に「見つかりません」を返す（HTTP 200 のストリーム内で404扱い）。明細の中身は含まれないこと
  check("SNS責任者は委託の稼働明細を開けない", (snsStmt.status === 404 || snsStmt.html.includes("NEXT_HTTP_ERROR_FALLBACK;404")) && !has(snsStmt, "明細行") && !snsStmt.html.includes("支払予定日"));
  const r1 = await sns.raw(`/api/export/statement?id=${stmt.id}&format=pdf`);
  check("SNS責任者は明細PDFを取得できない", r1.status === 404, `status=${r1.status}`);
  const toD = await sns.raw("/d", { headers: { accept: "text/html" } });
  check("会社側の利用者はドライバー画面に入れない", toD.status === 307 && (toD.headers.get("location") ?? "").includes("/app"), `${toD.status} ${toD.headers.get("location")}`);
  const pl = await sns.get("/app/pl");
  check("責任者の損益は担当事業部のみ", has(pl, "SNS・AI開発事業部") && !has(pl, "業務委託事業部"));

  console.log("● 3. ドライバー: 全画面・権限・稼働希望・日報");
  const d3 = new Browser(BASE);
  await demoLogin(d3, "高橋 三郎（デモ）", "/d/login");
  for (const path of DRIVER_PAGES) {
    const p = await d3.get(path);
    check(`ドライバー ${path}`, p.status === 200 && !has(p, "Application error"), `status=${p.status}`);
  }
  const toApp = await d3.raw("/app", { headers: { accept: "text/html" } });
  check("ドライバーは会社側画面に入れない", toApp.status === 307 && (toApp.headers.get("location") ?? "").startsWith("/d"), `${toApp.status} ${toApp.headers.get("location")}`);
  const [other] = await q<{ id: string }>("select s.id from statement s join app_user u on u.id = s.driver_id where u.name <> '高橋 三郎（デモ）' and s.status = 'PUBLISHED' limit 1");
  const r2 = await d3.raw(`/api/export/statement?id=${other.id}&format=pdf`);
  check("ドライバーは他人の明細PDFを取得できない", r2.status === 404, `status=${r2.status}`);
  const mine = await d3.raw(`/api/export/statement?id=${(await q<{ id: string }>("select s.id from statement s join app_user u on u.id = s.driver_id where u.name = '高橋 三郎（デモ）' limit 1"))[0].id}&format=pdf`);
  check("ドライバーは自分の公開済み明細PDFを取得できる", mine.status === 200 && (mine.headers.get("content-type") ?? "").includes("pdf"));
  const x = await d3.raw(`/api/export/schedule?month=${cur}&scope=all`);
  check("ドライバーのスケジュールExcel", x.status === 200 && (x.headers.get("content-type") ?? "").includes("spreadsheet"));

  const home = await d3.get("/d");
  check("ホームに稼働希望の未提出が出る", has(home, "稼働希望が未提出"));
  const av = await d3.get(`/d/availability?month=${next}`);
  const [nf, nt] = [`${next}-01`, (await q<{ d: string }>(`select (date_trunc('month', $1::date) + interval '1 month - 1 day')::date::text d`, [`${next}-01`]))[0].d];
  const days: { date: string; kind: string; start?: string; end?: string }[] = [];
  for (let d = new Date(`${nf}T00:00:00Z`); d.toISOString().slice(0, 10) <= nt; d.setUTCDate(d.getUTCDate() + 1)) {
    const dow = d.getUTCDay();
    days.push({ date: d.toISOString().slice(0, 10), kind: dow === 0 || dow === 6 ? "UNAVAILABLE" : dow === 3 ? "TIME" : "AVAILABLE", start: "09:00", end: "15:00" });
  }
  const avs = await d3.submit(av, "提出する", { days: JSON.stringify(days), submit: "1" });
  check("稼働希望を提出", has(avs, "稼働希望を提出しました") && has(avs, "提出済み"), notice(avs));
  const subRow = await q<{ status: string }>("select s.status from availability_submission s join app_user u on u.id = s.driver_id where u.name = '高橋 三郎（デモ）' and s.month = $1", [next]);
  check("DBでも提出済み", subRow[0]?.status === "SUBMITTED");
  const again = await d3.submit(await d3.get(`/d/availability?month=${next}`), "変更を申請", { date: `${next}-10`, kind: "UNAVAILABLE", reason: "通院のため" });
  check("提出後は変更申請", has(again, "変更申請を送りました"), notice(again));

  const missing = await q<{ work_date: string; project_id: string }>("select a.work_date::text, s.project_id from assignment a join shift_slot s on s.id = a.slot_id join app_user u on u.id = a.driver_id where u.name = '高橋 三郎（デモ）' and a.status = 'CONFIRMED' and a.work_date <= (now() at time zone 'Asia/Tokyo')::date and not exists (select 1 from daily_report r where r.driver_id = a.driver_id and r.work_date = a.work_date and r.project_id = s.project_id) order by a.work_date desc limit 1");
  let reportId = "";
  if (missing.length) {
    const form = await d3.get(`/d/reports/new?date=${missing[0].work_date}&project=${missing[0].project_id}`);
    check("日報: 確定スケジュールから初期値", has(form, "確定スケジュール"));
    const isQty = form.$("input[name=quantity]").length > 0;
    const sent = await d3.submit(form, "提出する", { submit: "1", ...(isQty ? { quantity: "95" } : {}), notes: "E2E 配送完了" });
    check("日報を提出", has(sent, "日報を提出しました"), notice(sent));
    reportId = sent.url.split("/").pop()!.split("?")[0];
  } else check("日報: 未提出日がある", false, "対象なし");

  console.log("● 4. 会社側: 日報承認・招待・割当・明細");
  const dm = new Browser(BASE);
  await demoLogin(dm, "委託 責任者（デモ）");
  if (reportId) {
    const rp = await dm.get(`/app/reports/${reportId}`);
    const ap = await dm.submit(rp, "承認", {}, (f) => f.find("input[name=id]").attr("value") === reportId);
    check("責任者が日報を承認", has(ap, "承認しました"), notice(ap));
  }
  const invPage = await dm.get("/app/drivers");
  const inv = await dm.submit(invPage, "招待リンクを作成", { name: "E2E 新人", email: "" });
  const url = (notice(inv).match(/http\S+\/d\/invite\/[A-Za-z0-9_-]+/) ?? [""])[0];
  check("招待リンクを作成", !!url, notice(inv));
  const newbie = new Browser(BASE);
  const ip = await newbie.get(url.replace(BASE, ""));
  check("招待ページ", has(ip, "E2E 新人"));
  const bound = await newbie.submit(ip, "模擬LINEで連携する");
  check("連携後は承認待ち", has(bound, "承認後にログイン"), text(bound).slice(0, 120));
  const reuse = await newbie.get(url.replace(BASE, ""));
  check("招待リンクは1回限り", has(reuse, "この招待リンクは使えません"));
  const [nu] = await q<{ id: string; status: string }>("select id, status from app_user where name = 'E2E 新人'");
  check("DBで承認待ち", nu.status === "PENDING");
  const dp = await dm.get(`/app/drivers/${nu.id}`);
  const ok = await dm.submit(dp, "承認して利用開始");
  check("責任者が承認", has(ok, "承認しました"), notice(ok));
  const stop = await dm.submit(await dm.get(`/app/drivers/${nu.id}`), "利用停止");
  check("利用停止", has(stop, "保存しました"), notice(stop));
  const [ns] = await q<{ status: string; n: number }>("select u.status, (select count(*)::int from session s where s.user_id = u.id) n from app_user u where id = $1", [nu.id]);
  check("停止で即ログイン不可（セッション削除）", ns.status === "SUSPENDED" && ns.n === 0);

  const sh = await dm.get(`/app/shifts?month=${next}`);
  check("スケジュール画面（翌月）", has(sh, "稼働希望の受付") && has(sh, "提出済み"));
  const slot = await dm.submit(sh, "枠を作成", { projectId: (await q<{ id: string }>("select id from project where code = 'DLV-A'"))[0].id, from: `${next}-03`, to: `${next}-07`, requiredCount: "2" });
  check("稼働枠を作成", has(slot, "稼働枠を") , notice(slot));
  const auto = await dm.submit(await dm.get(`/app/shifts?month=${next}`), "④ 自動で割当（下書き）");
  check("自動割当（下書き）", has(auto, "下書きの割当を"), notice(auto));
  const ovl = await q<{ n: number }>("select count(*)::int n from assignment a join assignment b on a.driver_id = b.driver_id and a.work_date = b.work_date and a.id < b.id and a.status <> 'CANCELED' and b.status <> 'CANCELED' and a.start_time < b.end_time and b.start_time < a.end_time");
  check("同じドライバーの時間重複なし", ovl[0].n === 0);
  const unav = await q<{ n: number }>("select count(*)::int n from assignment a join availability v on v.driver_id = a.driver_id and v.work_date = a.work_date where a.status <> 'CANCELED' and v.kind = 'UNAVAILABLE'");
  check("稼働不可の日に割当なし", unav[0].n === 0);
  const sx = await dm.raw(`/api/export/schedule?month=${prev}&scope=division&id=${divs.find((d) => d.code === "DRV")!.id}`);
  check("事業部別スケジュールExcel", sx.status === 200);

  const st = await dm.get(`/app/statements?month=${prev}`);
  check("稼働明細一覧（前月・公開済み）", has(st, "公開済み"));
  const gen = await dm.submit(st, `${prev.replace("-", "年")}月の明細を作成・再生成`);
  check("確定済みは再生成しても変わらない", has(gen, "確定済みのため変更なし 3件"), notice(gen));

  console.log("● 5. 入出金（提供者・本社・スタッフ）・Clean Up・契約・メール");
  const SELF = "00000000-0000-4000-8000-000000000001";
  const prov = new Browser(BASE);
  const pHome = await demoLogin(prov, "提供者 一郎（デモ）");
  check("提供者はログイン後に提供者画面", has(pHome, "担当会社") && has(pHome, "サービス提供者画面"));
  check("提供者には担当外の会社が表示されない", !has(pHome, "架空物産"));
  for (const path of [`/p/${SELF}`, `/p/${SELF}/accounts`, `/p/${SELF}/disclosure`, `/p/${SELF}/preview`, `/p/${SELF}/audit`]) {
    const pg = await prov.get(path);
    check(`提供者 ${path.replace(SELF, "自社")}`, pg.status === 200 && !has(pg, "処理に失敗しました") && !has(pg, "Application error"), `status=${pg.status}`);
  }
  const [otherCo] = await q<{ id: string }>("select id from company where not is_self limit 1");
  const pOther = await prov.get(`/p/${otherCo.id}`);
  check("提供者は担当外の会社を開けない", pOther.status === 404 || pOther.html.includes("NEXT_HTTP_ERROR_FALLBACK;404"));
  const pToApp = await prov.get("/app");
  check("提供者は本社の画面に入れない", has(pToApp, "サービス提供者画面") && !has(pToApp, "経営ダッシュボード"));
  const [bacc] = await q<{ id: string }>(`select id from bank_account where company_id = '${SELF}' limit 1`);
  const csv = "日付,内容,入金,出金,残高\r\n2026/10/20,振込 テスト E2E,10000,,100000\r\n";
  const imp1 = await prov.submit(await prov.get(`/p/${SELF}/accounts`), "明細CSVを取込", { file: { name: "bank.csv", type: "text/csv", bytes: new TextEncoder().encode(csv) } }, (f) => f.find("input[name=id]").attr("value") === bacc.id);
  const imp2 = await prov.submit(await prov.get(`/p/${SELF}/accounts`), "明細CSVを取込", { file: { name: "bank.csv", type: "text/csv", bytes: new TextEncoder().encode(csv) } }, (f) => f.find("input[name=id]").attr("value") === bacc.id);
  check("銀行CSVは2回目は取込済み", has(imp1, "新規 1件") && has(imp2, "新規 0件・取込済み 1件"), `${notice(imp1)} | ${notice(imp2)}`);
  const [newT] = await q<{ id: string; publish_status: string; hq_visible: boolean }>("select id, publish_status::text, hq_visible from bank_transaction where description = '振込 テスト E2E'");
  check("取り込んだ取引は下書き", newT.publish_status === "DRAFT" && !newT.hq_visible);
  const pList = await prov.get(`/p/${SELF}`);
  check("提供者の一覧に公開状況の列", has(pList, "本社公開") && has(pList, "スタッフ公開") && has(pList, "公開対象") && has(pList, "最終変更者") && has(pList, "振込 テスト E2E"));
  const pDetail = await prov.get(`/p/${SELF}/t/${newT.id}`);
  check("提供者の取引詳細（原本・表示先・訂正・集計対象外）", has(pDetail, "原本") && has(pDetail, "表示先") && has(pDetail, "訂正を追加") && has(pDetail, "集計対象外にする"));
  const pPrev = await prov.get(`/p/${SELF}/preview?as=HQ`);
  check("見え方の確認（本社）", has(pPrev, "表示されないもの") && has(pPrev, "公開対象の入出金合計"));
  const [drv1] = await q<{ id: string }>("select id from app_user where email = 'driver1@demo.invalid'");
  const pPrev2 = await prov.get(`/p/${SELF}/preview?as=${drv1.id}`);
  check("見え方の確認（スタッフ）", pPrev2.status === 200 && has(pPrev2, "佐藤 一郎"));
  const pExp = await prov.raw(`/api/finance/export?company=${SELF}`);
  check("提供者のCSV出力", pExp.status === 200 && (await pExp.text()).includes("振込 テスト E2E"));
  const pExpOther = await prov.raw(`/api/finance/export?company=${otherCo.id}`);
  check("提供者は担当外の会社のCSVを出力できない", pExpOther.status === 404, `status=${pExpOther.status}`);

  const acct = new Browser(BASE);
  await demoLogin(acct, "経理 花子（デモ）");
  const bp = await acct.get("/app/bank");
  const [pub] = await q<{ id: string; description: string }>(`select t.id, t.description from bank_transaction t join bank_account a on a.id = t.account_id where a.company_id = '${SELF}' and t.publish_status = 'PUBLISHED' and t.hq_visible limit 1`);
  const [hidden] = await q<{ id: string; description: string }>(`select t.id, t.description from bank_transaction t join bank_account a on a.id = t.account_id where a.company_id = '${SELF}' and not (t.publish_status = 'PUBLISHED' and t.hq_visible) and t.description not in (select description from bank_transaction where publish_status = 'PUBLISHED' and hq_visible) limit 1`);
  check("本社: 公開対象の入出金合計として表示", has(bp, "公開対象の入出金合計") && has(bp, "実際の銀行残高や会社全体の収支ではありません"));
  check("本社: 銀行の取込・連携の操作はない", !has(bp, "明細CSVを取込") && !has(bp, "口座を登録"));
  check("本社: 公開した取引は見え、非公開は見えない", has(bp, pub.description) && !has(bp, "振込 テスト E2E") && (!hidden || !has(bp, hidden.description)));
  const hqDraft = await acct.get(`/app/bank/${newT.id}`);
  check("本社: 非公開の取引はURLを直接開いても見えない", (hqDraft.status === 404 || hqDraft.html.includes("NEXT_HTTP_ERROR_FALLBACK;404")) && !has(hqDraft, "振込 テスト E2E"));
  const hqPub = await acct.get(`/app/bank/${pub.id}`);
  check("本社: 公開した取引の詳細は開ける", hqPub.status === 200 && has(hqPub, pub.description));
  const hqExp = await acct.raw("/api/finance/export");
  check("本社: CSV出力は許可されるまで不可", hqExp.status === 403, `status=${hqExp.status}`);
  const hqP = await acct.get(`/p/${SELF}`);
  check("本社は提供者画面に入れない", !has(hqP, "サービス提供者画面") && !has(hqP, "公開状況"));
  const hqAudit = await owner.get("/app/audit");
  check("本社の監査ログに入出金の操作が出ない", !has(hqAudit, "表示先を変更") && !has(hqAudit, "明細CSV"));

  const sato = new Browser(BASE);
  await demoLogin(sato, "佐藤 一郎（デモ）", "/d/login");
  const sMore = await sato.get("/d/more");
  const sFin = await sato.get("/d/finance");
  const [toSato] = await q<{ description: string }>(`select t.description from bank_transaction t join bank_txn_audience x on x.transaction_id = t.id and x.kind = 'USER' where x.target_id = '${drv1.id}' limit 1`);
  check("スタッフ: 自分あての入出金が見える", has(sMore, "入出金（公開分）") && has(sFin, toSato.description) && !has(sFin, "振込 テスト E2E"), `more=${has(sMore, "入出金（公開分）")} fin=${sFin.status} ${toSato.description} ${text(sFin).slice(0, 300)}`);
  check("スタッフ: 会社全体の残高は表示されない", !has(sFin, "実際の銀行残高"));
  const suzuki = new Browser(BASE);
  await demoLogin(suzuki, "鈴木 次郎（デモ）", "/d/login");
  const zFin = await suzuki.get("/d/finance");
  const satoOnly = await q<{ description: string }>(`select t.description from bank_transaction t join bank_txn_audience x on x.transaction_id = t.id and x.kind = 'USER' and x.target_id = '${drv1.id}'
    where t.description not in (select t2.description from bank_transaction t2 join bank_txn_audience x2 on x2.transaction_id = t2.id and x2.kind = 'DIVISION' where t2.publish_status = 'PUBLISHED' and t2.staff_visible) limit 1`);
  check("スタッフ: 他のスタッフあての入出金は見えない", zFin.status === 200 && (satoOnly.length === 0 || !has(zFin, satoOnly[0].description)), satoOnly[0]?.description);
  const cu = await acct.get("/app/cleanup");
  const cleanupCsv = "請求書番号,取引先コード,取引先,発行日,期間開始,期間終了,支払期限,小計,消費税,合計,入金済,状態\r\nINV-E2E-001,C001,杜の都ビル管理株式会社（デモ）,2026-10-31,2026-10-01,2026-10-31,2026-11-30,120000,12000,132000,0,issued\r\n";
  const ci = await acct.submit(cu, "取り込む", { file: { name: "invoices.csv", type: "text/csv", bytes: new TextEncoder().encode(cleanupCsv) } });
  check("Clean Up 請求書CSV取込", has(ci, "新規 1件"), notice(ci));
  const ci2 = await acct.submit(await acct.get("/app/cleanup"), "取り込む", { file: { name: "invoices.csv", type: "text/csv", bytes: new TextEncoder().encode(cleanupCsv) } });
  check("Clean Up 再取込で重複なし", has(ci2, "新規 0件"), notice(ci2));
  const cron = await fetch(`${BASE}/api/cron`, { headers: { authorization: `Bearer ${CRON}` } });
  const cj = (await cron.json()) as { ok: boolean };
  check("定期処理（認証あり）", cron.status === 200 && cj.ok);
  const cronNg = await fetch(`${BASE}/api/cron`, { headers: { authorization: "Bearer wrong" } });
  check("定期処理（認証なしは拒否）", cronNg.status === 401);
  const slackNg = await fetch(`${BASE}/api/slack/command`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", "x-slack-request-timestamp": String(Math.floor(Date.now() / 1000)), "x-slack-signature": "v0=bad" }, body: "text=hello&user_id=U1" });
  check("Slack /ai（署名なしは拒否）", slackNg.status === 401 || slackNg.status === 403, String(slackNg.status));
  const resultNg = await fetch(`${BASE}/api/slack/result`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: "00000000-0000-0000-0000-000000000000", token: "x", status: "done", result: "x" }) });
  check("Claude の結果（合言葉なしは拒否）", resultNg.status >= 400 && resultNg.status < 500, String(resultNg.status));
  const mails = await q<{ n: number; skipped: number }>("select count(*)::int n, count(*) filter (where status = 'SKIPPED')::int skipped from email_outbox where kind = 'AVAILABILITY_REMINDER'");
  check("提出済みの人にはリマインドを送らない", (await q<{ n: number }>("select count(*)::int n from email_outbox e join availability_submission s on s.driver_id = e.to_user_id and s.month = e.context->>'month' where e.kind = 'AVAILABILITY_REMINDER' and e.status = 'SENT' and s.submitted_at < e.sent_at"))[0].n === 0, JSON.stringify(mails[0]));

  const ct = await owner.get("/app/contracts");
  check("契約書一覧（デモ契約）", has(ct, "SNS画像制作"));
  const [cid] = await q<{ id: string }>("select id from contract limit 1");
  const cp = await owner.raw(`/api/export/contract?id=${cid.id}`);
  check("契約書PDF", cp.status === 200 && (cp.headers.get("content-type") ?? "").includes("pdf"));
  const sign = await owner.get(`/app/contracts/${cid.id}`);
  const signNoFile = await owner.submit(sign, "締結済みにする");
  check("締結済みファイルなしでは締結できない", has(signNoFile, "締結済みの契約書ファイル"), notice(signNoFile));

  const audit = await owner.get("/app/audit");
  check("監査ログに操作が残る", has(audit, "招待") && has(audit, "日報"));
  const logout = await owner.get("/app");
  void logout;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
