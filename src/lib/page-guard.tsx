import "server-only";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { Forbidden } from "@/components/states";
import { AppError } from "@/lib/errors";

/** ページ描画時の業務エラーを画面に変換（権限不足→権限不足画面、存在しない→404） */
export async function guard(render: () => Promise<ReactNode>): Promise<ReactNode> {
  try {
    return await render();
  } catch (e) {
    if (e instanceof AppError) {
      if (e.code === "FORBIDDEN") return <Forbidden message={e.message} />;
      if (e.code === "NOT_FOUND") notFound();
    }
    throw e;
  }
}
