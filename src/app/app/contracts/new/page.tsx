import { ActionForm } from "@/components/action-form";
import { Card, EmptyState, LinkButton, PageHeader } from "@/components/ui";
import { getDb } from "@/db";
import { can } from "@/lib/access";
import { requireStaff } from "@/lib/session";
import { Forbidden } from "@/components/states";
import { createContractAction } from "../actions";
import { ContractFields } from "../contract-fields";
import { contractOptions } from "../options";

export const metadata = { title: "契約書を作成" };

export default async function NewContract() {
  const actor = await requireStaff();
  if (!can.manageContracts(actor)) return <Forbidden message="契約書の作成は経営者・事業部責任者のみ可能です。" />;
  const o = await contractOptions(getDb(), actor);
  return (
    <>
      <PageHeader title="契約書を作成" back={{ href: "/app/contracts", label: "契約書一覧" }} />
      {o.templates.length === 0 ? (
        <EmptyState title="承認済みのテンプレートがありません">テンプレートの内容を確認し、経営者が承認すると契約書を作成できます。<div className="mt-3"><LinkButton href="/app/contracts/templates">テンプレートへ</LinkButton></div></EmptyState>
      ) : (
        <Card>
          <ActionForm action={createContractAction} submitLabel="下書きを作成">
            <ContractFields {...o} />
          </ActionForm>
        </Card>
      )}
    </>
  );
}
