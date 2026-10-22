/** 非公開ファイル保存（local / db / supabase）。取得時は必ず呼び出し側で権限を確認する */
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { invalid } from "@/lib/errors";

export const MAX_FILE_BYTES = 10 * 1024 * 1024;
export type AllowedMime = "image/jpeg" | "image/png" | "image/webp" | "application/pdf";

export function sniffMime(b: Uint8Array): AllowedMime | null {
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) return "image/png";
  if (b.length >= 12 && String.fromCharCode(...b.slice(0, 4)) === "RIFF" && String.fromCharCode(...b.slice(8, 12)) === "WEBP") return "image/webp";
  if (b.length >= 5 && String.fromCharCode(...b.slice(0, 5)) === "%PDF-") return "application/pdf";
  return null;
}

export function validateFile(b: Uint8Array, allowed: AllowedMime[] = ["image/jpeg", "image/png", "image/webp", "application/pdf"]) {
  if (b.length === 0) throw invalid("空のファイルは添付できません");
  if (b.length > MAX_FILE_BYTES) throw invalid("ファイルは10MB以下にしてください");
  const m = sniffMime(b);
  if (!m || !allowed.includes(m)) throw invalid(`添付できる形式は ${allowed.map((x) => x.split("/")[1].toUpperCase()).join(" / ")} です`);
  return m;
}

export function safeName(name: string) {
  return (path.basename(name || "file").replace(/[\u0000-\u001f\\/:*?"<>|]/g, "_").slice(0, 120)) || "file";
}

export type StorageDriver = "local" | "db" | "supabase";
/** 未指定のとき: Vercel（書き込めるディスクがない）ではデータベースに保存、それ以外はローカルディスク */
export function storageDriver(): StorageDriver {
  const d = process.env.STORAGE_DRIVER;
  if (d === "supabase" || d === "db" || d === "local") return d;
  return process.env.VERCEL ? "db" : "local";
}

async function blobTable() {
  const [{ getDb }, { storedBlob }, { eq }] = await Promise.all([import("@/db"), import("@/db/schema"), import("drizzle-orm")]);
  return { db: getDb(), storedBlob, eq };
}

function localRoot() {
  return path.resolve(/*turbopackIgnore: true*/ process.env.STORAGE_DIR || "./.data/storage");
}
function keyPath(key: string) {
  if (!/^[a-z]+\/[0-9a-f-]{36}$/.test(key)) throw new Error("invalid key");
  return path.join(localRoot(), key);
}

async function supabase() {
  const { createClient } = await import("@supabase/supabase-js");
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY が未設定です");
  return { client: createClient(url, key, { auth: { persistSession: false } }), bucket: process.env.SUPABASE_STORAGE_BUCKET || "ace-private" };
}

export async function putObject(folder: string, bytes: Uint8Array, mime: string): Promise<string> {
  const key = `${folder}/${crypto.randomUUID()}`;
  if (storageDriver() === "supabase") {
    const { client, bucket } = await supabase();
    const { error } = await client.storage.from(bucket).upload(key, bytes, { contentType: mime, upsert: false });
    if (error) throw new Error(`ファイル保存に失敗しました: ${error.message}`);
    return key;
  }
  if (storageDriver() === "db") {
    keyPath(key);
    const { db, storedBlob } = await blobTable();
    await db.insert(storedBlob).values({ key, bytes: Buffer.from(bytes) });
    return key;
  }
  const p = keyPath(key);
  await mkdir(path.dirname(p), { recursive: true, mode: 0o700 });
  await writeFile(`${p}.tmp`, bytes, { mode: 0o600 });
  await rename(`${p}.tmp`, p);
  return key;
}

export async function getObject(key: string): Promise<Buffer> {
  if (storageDriver() === "supabase") {
    const { client, bucket } = await supabase();
    const { data, error } = await client.storage.from(bucket).download(key);
    if (error || !data) throw new Error("ファイルを取得できませんでした");
    return Buffer.from(await data.arrayBuffer());
  }
  if (storageDriver() === "db") {
    keyPath(key);
    const { db, storedBlob, eq } = await blobTable();
    const [r] = await db.select().from(storedBlob).where(eq(storedBlob.key, key)).limit(1);
    if (!r) throw new Error("ファイルを取得できませんでした");
    return Buffer.from(r.bytes);
  }
  return readFile(keyPath(key));
}

export async function deleteObject(key: string) {
  if (storageDriver() === "supabase") {
    const { client, bucket } = await supabase();
    await client.storage.from(bucket).remove([key]);
    return;
  }
  if (storageDriver() === "db") {
    const { db, storedBlob, eq } = await blobTable();
    await db.delete(storedBlob).where(eq(storedBlob.key, key));
    return;
  }
  await unlink(keyPath(key)).catch(() => undefined);
}
