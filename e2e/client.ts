/**
 * E2E用の簡易HTTPクライアント。
 * 画面のHTMLからフォームを読み取り、JavaScriptなしでブラウザが送信するのと同じ形式（multipart）で送信する。
 * Server Actions はプログレッシブエンハンスメントにより、この形式でも実行される。
 */
import * as cheerio from "cheerio";

export type Page = { status: number; url: string; html: string; $: cheerio.CheerioAPI; headers: Headers };

export class Browser {
  private cookies = new Map<string, string>();
  constructor(public base: string) {}

  private cookieHeader() {
    return [...this.cookies.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
  }

  private store(h: Headers) {
    for (const c of h.getSetCookie()) {
      const [pair] = c.split(";");
      const i = pair.indexOf("=");
      const k = pair.slice(0, i).trim();
      const v = pair.slice(i + 1).trim();
      if (/max-age=0/i.test(c) || v === "") this.cookies.delete(k);
      else this.cookies.set(k, v);
    }
  }

  async raw(path: string, init: RequestInit = {}): Promise<Response> {
    const res = await fetch(new URL(path, this.base), {
      ...init,
      redirect: "manual",
      headers: { cookie: this.cookieHeader(), origin: this.base, ...(init.headers ?? {}) },
    });
    this.store(res.headers);
    return res;
  }

  async get(path: string, depth = 0): Promise<Page> {
    const res = await this.raw(path, { headers: { accept: "text/html" } });
    if (res.status >= 300 && res.status < 400 && res.headers.get("location") && depth < 5) {
      return this.get(res.headers.get("location")!, depth + 1);
    }
    const html = await res.text();
    return { status: res.status, url: new URL(path, this.base).pathname + new URL(path, this.base).search, html, $: cheerio.load(html), headers: res.headers };
  }

  async login(email: string, password: string) {
    const res = await this.raw("/api/auth/sign-in/email", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    if (res.status !== 200) throw new Error(`ログイン失敗 ${email}: ${res.status} ${await res.text()}`);
  }

  /**
   * ページ上のフォームを送信する。
   * @param buttonText 送信ボタンの文言でフォームを特定
   * @param match フォームを絞り込む追加条件（hidden の値など）
   */
  async submit(
    page: Page,
    buttonText: string,
    values: Record<string, string | string[] | { name: string; type: string; bytes: Uint8Array }> = {},
    match?: (form: cheerio.Cheerio<never>) => boolean,
  ): Promise<Page> {
    const $ = page.$;
    const forms = $("form")
      .toArray()
      .filter((f) => $(f).find("button[type=submit]").toArray().some((b) => $(b).text().trim() === buttonText))
      .filter((f) => (match ? match($(f) as never) : true));
    if (forms.length === 0) throw new Error(`フォームが見つかりません: 「${buttonText}」 (${page.url})`);
    if (forms.length > 1 && !match) throw new Error(`フォームが複数あります: 「${buttonText}」`);
    const form = $(forms[0]);
    const fd = new FormData();
    const overridden = new Set(Object.keys(values));
    form.find("input, select, textarea").each((_, el) => {
      const e = $(el);
      const name = e.attr("name");
      if (!name || overridden.has(name) || e.attr("disabled") !== undefined) return;
      const tag = el.tagName.toLowerCase();
      const type = (e.attr("type") ?? "text").toLowerCase();
      if (tag === "input" && ["submit", "button", "file", "reset"].includes(type)) return;
      if (tag === "input" && (type === "checkbox" || type === "radio")) {
        if (e.attr("checked") !== undefined) fd.append(name, e.attr("value") ?? "on");
        return;
      }
      if (tag === "select") {
        const opt = e.find("option[selected]").first();
        fd.append(name, (opt.length ? opt : e.find("option").first()).attr("value") ?? "");
        return;
      }
      if (tag === "textarea") {
        fd.append(name, e.text());
        return;
      }
      fd.append(name, e.attr("value") ?? "");
    });
    for (const [k, v] of Object.entries(values)) {
      if (Array.isArray(v)) v.forEach((x) => fd.append(k, x));
      else if (typeof v === "string") fd.append(k, v);
      else fd.append(k, new Blob([v.bytes as Uint8Array<ArrayBuffer>], { type: v.type }), v.name);
    }
    const action = form.attr("action") || page.url;
    const res = await this.raw(action, { method: "POST", body: fd, headers: { accept: "text/html" } });
    if (res.status >= 300 && res.status < 400 && res.headers.get("location")) return this.get(res.headers.get("location")!);
    const html = await res.text();
    return { status: res.status, url: page.url, html, $: cheerio.load(html), headers: res.headers };
  }
}

/** 画面に表示されたテキスト（スクリプト・スタイルを除く） */
export function text(p: Page) {
  const $ = cheerio.load(p.html);
  $("script, style, noscript").remove();
  $("p, div, td, th, li, span, h1, h2, dt, dd, label, a, button, option").after(" ");
  return $("body").text().replace(/\s+/g, " ");
}
