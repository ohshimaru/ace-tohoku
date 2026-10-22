import "server-only";
/**
 * 電子署名サービスとの連携（未実装）
 * 現在は「送付」「締結」を人が操作し、締結済みファイルを保存する運用。
 * 将来、電子署名サービスを使う場合は EsignProvider を実装し、契約の「送付」時に send、
 * 完了通知（Webhook）で締結済みファイルを保存して状態を「締結済み」にする。
 * いずれの場合も、システムが自動で契約を締結（署名）することはしない。
 */
export interface EsignProvider {
  key: string;
  send(input: { contractId: string; title: string; pdf: Uint8Array; signerEmail: string; signerName: string }): Promise<{ envelopeId: string }>;
}

export function esignProvider(): EsignProvider | null {
  return null; // 未接続
}
