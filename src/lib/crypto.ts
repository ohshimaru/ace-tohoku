import { createHash, createHmac, randomBytes, scrypt as _scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(_scrypt) as (pw: string, salt: Buffer, len: number, opts: { N: number; r: number; p: number }) => Promise<Buffer>;
const PARAMS = { N: 16384, r: 8, p: 1 };

/** パスワードのハッシュ（scrypt、ソルト付き） */
export async function hashPassword(pw: string): Promise<string> {
  if (pw.length < 10) throw new Error("パスワードは10文字以上にしてください");
  if (pw.length > 128) throw new Error("パスワードが長すぎます");
  const salt = randomBytes(16);
  const key = await scrypt(pw, salt, 64, PARAMS);
  return `scrypt$${salt.toString("base64")}$${key.toString("base64")}`;
}

export async function verifyPassword(pw: string, stored: string | null): Promise<boolean> {
  if (!stored) {
    // 時間差でアカウントの有無が分からないよう、ダミー計算を行う
    await scrypt(pw, Buffer.alloc(16), 64, PARAMS);
    return false;
  }
  const [alg, s, k] = stored.split("$");
  if (alg !== "scrypt" || !s || !k) return false;
  const key = await scrypt(pw, Buffer.from(s, "base64"), 64, PARAMS);
  const expected = Buffer.from(k, "base64");
  return key.length === expected.length && timingSafeEqual(key, expected);
}

export function randomToken(bytes = 32) {
  return randomBytes(bytes).toString("base64url");
}

export function sha256(s: string) {
  return createHash("sha256").update(s).digest("hex");
}

function secret() {
  const s = process.env.APP_SECRET;
  if (!s || s.length < 32) throw new Error("APP_SECRET（32文字以上）が設定されていません");
  return s;
}

/** 署名付きの値（Cookie に入れる一時データ用） */
export function sign(value: string) {
  const mac = createHmac("sha256", secret()).update(value).digest("base64url");
  return `${Buffer.from(value).toString("base64url")}.${mac}`;
}

export function unsign(signed: string | undefined): string | null {
  if (!signed) return null;
  const [v, mac] = signed.split(".");
  if (!v || !mac) return null;
  const value = Buffer.from(v, "base64url").toString();
  const expected = createHmac("sha256", secret()).update(value).digest("base64url");
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b) ? value : null;
}
