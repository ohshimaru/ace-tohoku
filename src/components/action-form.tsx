"use client";

import { useActionState, useEffect, useRef, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import type { ActionResult } from "@/lib/action";
import { Button, Notice } from "./ui";

type Action = (prev: ActionResult, fd: FormData) => Promise<ActionResult>;

/** Server Action を呼び、結果（成功・エラー）を明示するフォーム */
export function ActionForm({
  action,
  children,
  submitLabel = "保存",
  submitVariant = "primary",
  confirm,
  resetOnSuccess = false,
  className,
  inline = false,
  hideMessageOnSuccess = false,
}: {
  action: Action;
  children?: ReactNode;
  submitLabel?: string;
  submitVariant?: "primary" | "secondary" | "danger";
  confirm?: string;
  resetOnSuccess?: boolean;
  className?: string;
  inline?: boolean;
  hideMessageOnSuccess?: boolean;
}) {
  const [state, formAction] = useActionState(action, { ok: false, message: "", at: 0 });
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.ok && resetOnSuccess) ref.current?.reset();
  }, [state, resetOnSuccess]);
  return (
    <form
      ref={ref}
      action={formAction}
      className={className ?? (inline ? "inline-flex flex-wrap items-end gap-2" : "space-y-4")}
      onSubmit={(e) => {
        if (confirm && !window.confirm(confirm)) e.preventDefault();
      }}
    >
      {children}
      <div className={inline ? "contents" : "flex flex-wrap items-center gap-3"}>
        <Submit label={submitLabel} variant={submitVariant} />
      </div>
      {state.at > 0 && !(state.ok && hideMessageOnSuccess) && (
        <div className={inline ? "basis-full" : ""} key={state.at}>
          <Notice tone={state.ok ? "ok" : "bad"}>{state.message}</Notice>
        </div>
      )}
    </form>
  );
}

function Submit({ label, variant }: { label: string; variant: "primary" | "secondary" | "danger" }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant={variant} disabled={pending} aria-busy={pending}>
      {pending ? "処理中…" : label}
    </Button>
  );
}
