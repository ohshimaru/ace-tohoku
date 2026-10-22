import { ActionForm } from "@/components/action-form";
import { Input } from "@/components/ui";
import { approveReportAction, returnReportAction } from "@/app/app/reports/actions";

/** 日報の承認・差戻しボタン（一覧・承認画面で共通） */
export function ReportDecision({ id, returnTo }: { id: string; returnTo: string }) {
  return (
    <div className="flex flex-wrap items-end gap-2">
      <ActionForm action={approveReportAction} inline submitLabel="承認" submitVariant="secondary"><input type="hidden" name="id" value={id} /><input type="hidden" name="returnTo" value={returnTo} /></ActionForm>
      <ActionForm action={returnReportAction} inline submitLabel="差戻し" submitVariant="ghost"><input type="hidden" name="id" value={id} /><input type="hidden" name="returnTo" value={returnTo} /><Input name="reason" placeholder="差戻し理由" required className="w-40" /></ActionForm>
    </div>
  );
}
