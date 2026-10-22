import "dotenv/config";
import os from "node:os";
import path from "node:path";

if (!process.env.TEST_DATABASE_URL) throw new Error("TEST_DATABASE_URL を設定してください（本番DBは使わないこと）");
if (process.env.TEST_DATABASE_URL === process.env.DATABASE_URL) throw new Error("TEST_DATABASE_URL と DATABASE_URL が同じです");
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
process.env.STORAGE_DRIVER = "local";
process.env.STORAGE_DIR = path.join(os.tmpdir(), `ace-test-storage-${process.pid}`);
process.env.EMAIL_DRIVER = "console";
process.env.APP_SECRET ||= "test-secret-test-secret-test-secret-0123";
