import Link from "next/link";
import { Card, PageHeader } from "@/components/ui";
import { getDb } from "@/db";
import { ROLE_LABELS } from "@/lib/access";
import { guideSteps } from "@/lib/guide";
import { requireStaff } from "@/lib/session";
import { listDivisions } from "@/server/masters";

export const metadata = { title: "使い方" };

const MENU: [string, string, string][] = [
  ["ダッシュボード", "/app", "今月の売上・利益・資金と、AIからの対応指示をまとめて表示"],
  ["対応すること", "/app/actions", "ルールで見つけた問題点と、次にやること・担当・期限"],
  ["損益・予実", "/app/pl", "事業部別・案件別の利益と、予算に対する実績"],
  ["予算", "/app/budget", "予算ルール（固定・人数・売上連動など）と使用可能額"],
  ["売上・入金 / 経費", "/app/sales", "売上と入金、経費と支払を別々に記録"],
  ["承認", "/app/approvals", "経費・日報・予算追加の申請を処理"],
  ["銀行口座", "/app/bank", "入出金の確認と照合（送金は行いません）"],
  ["顧客・取引先 / 案件", "/app/partners", "取引先と案件の管理"],
  ["契約書", "/app/contracts", "テンプレートから契約書を作り、締結まで管理"],
  ["ドライバー / 稼働スケジュール / 日報 / 稼働明細", "/app/drivers", "業務委託ドライバーの招待・稼働の割当・日報・毎月の明細"],
  ["Clean Up連携", "/app/cleanup", "清掃事業部の請求書CSVを取り込み"],
];

export default async function GuidePage() {
  const actor = await requireStaff();
  const divisions = await listDivisions(getDb(), actor);
  const steps = guideSteps(actor.role, { hasDriverDivision: divisions.some((d) => d.kind === "DRIVER") });
  return (
    <>
      <PageHeader title="使い方" description={`${actor.name}（${ROLE_LABELS[actor.role]}）の画面の使い方`} />
      <Card title="まずはここから">
        <ol className="space-y-4">
          {steps.map((s, i) => (
            <li key={s.href} className="flex flex-col gap-1 sm:flex-row sm:items-start sm:gap-4">
              <span className="text-sm font-bold text-navy-500">ステップ {i + 1}</span>
              <div className="min-w-0 flex-1"><p className="font-bold text-navy-900">{s.title}</p><p className="text-sm text-muted">{s.body}</p></div>
              <Link className="shrink-0 text-sm font-bold text-navy-700 underline" href={s.href}>{s.cta} →</Link>
            </li>
          ))}
        </ol>
      </Card>
      <Card title="メニューの説明" className="mt-6">
        <dl className="divide-y divide-line">
          {MENU.map(([name, href, desc]) => (
            <div key={href} className="flex flex-col gap-1 py-3 sm:flex-row sm:gap-6">
              <dt className="font-bold sm:w-72"><Link className="text-navy-700 underline" href={href}>{name}</Link></dt>
              <dd className="text-sm text-muted">{desc}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-3 text-xs text-muted">権限によって表示されないメニューがあります（例: 銀行口座は経営者・経理のみ）。</p>
      </Card>
    </>
  );
}
