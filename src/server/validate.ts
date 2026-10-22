import { z } from "zod";
import { isValidDate, MONTH_RE } from "@/lib/dates";
import { invalid } from "@/lib/errors";
import { parseYen } from "@/lib/money";

/** zod の検証結果を日本語の業務エラーに変換して返す */
export function parse<T extends z.ZodType>(schema: T, data: unknown): z.infer<T> {
  const r = schema.safeParse(data);
  if (!r.success) {
    const first = r.error.issues[0];
    throw invalid(first?.message ?? "入力内容に誤りがあります");
  }
  return r.data;
}

const emptyToUndef = (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : v);

export const zText = (label: string, max = 200) =>
  z
    .string({ error: `${label}を入力してください` })
    .trim()
    .min(1, `${label}を入力してください`)
    .max(max, `${label}は${max}文字以内で入力してください`);

export const zOptText = (label: string, max = 2000) =>
  z.preprocess(emptyToUndef, z.string().trim().max(max, `${label}は${max}文字以内で入力してください`).optional()).optional();

export const zDate = (label: string) =>
  z
    .string({ error: `${label}を入力してください` })
    .refine((s) => isValidDate(s), `${label}の日付が正しくありません`);

export const zOptDate = (label: string) => z.preprocess(emptyToUndef, zDate(label).optional()).optional();

export const zMonth = (label: string) => z.string().regex(MONTH_RE, `${label}は YYYY-MM 形式で指定してください`);

export const zUuid = (label: string) => z.string({ error: `${label}を選択してください` }).uuid(`${label}を選択してください`);

export const zOptUuid = (label: string) => z.preprocess(emptyToUndef, zUuid(label).optional()).optional();

export const zYen = (label: string, { min = 0, allowNegative = false } = {}) =>
  z.union([z.string(), z.number()]).transform((v, ctx) => {
    try {
      const n = typeof v === "number" ? v : parseYen(v, { allowNegative });
      if (!Number.isSafeInteger(n)) throw new Error();
      if (n < min) {
        ctx.addIssue({ code: "custom", message: `${label}は${min.toLocaleString()}円以上で入力してください` });
        return z.NEVER;
      }
      return n;
    } catch {
      ctx.addIssue({ code: "custom", message: `${label}は整数の金額で入力してください` });
      return z.NEVER;
    }
  });

export const zOptYen = (label: string, opts?: { min?: number }) => z.preprocess(emptyToUndef, zYen(label, opts).optional()).optional();

/** "1.5"（時間）または "1:30" を分に変換 */
export const zDurationMinutes = (label: string) =>
  z.string().transform((v, ctx) => {
    const s = v.trim();
    let min: number | null = null;
    const hm = /^(\d{1,2}):([0-5]\d)$/.exec(s);
    if (hm) min = Number(hm[1]) * 60 + Number(hm[2]);
    else if (/^\d{1,2}(\.\d{1,2})?$/.test(s)) min = Math.round(Number(s) * 60);
    if (min === null || min <= 0 || min > 1440) {
      ctx.addIssue({ code: "custom", message: `${label}は 1.5 または 1:30 の形式で、24時間以内で入力してください` });
      return z.NEVER;
    }
    return min;
  });

/** ページ番号・件数 */
export function pageParams(page?: string | number, size = 20) {
  const p = Math.max(1, Math.min(10_000, Number(page) || 1));
  return { page: p, limit: size, offset: (p - 1) * size };
}

/** LIKE 用のエスケープ */
export function likePattern(q: string) {
  return `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}
