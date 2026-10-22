import type { ConnState } from "@/server/integrations";
import { Badge } from "./ui";

export function ConnBadge({ state }: { state: ConnState }) {
  if (state === "LIVE") return <Badge tone="ok">実接続</Badge>;
  if (state === "DEMO") return <Badge tone="warn">デモ</Badge>;
  return <Badge tone="neutral">未接続</Badge>;
}
