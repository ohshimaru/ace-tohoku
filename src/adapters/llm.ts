/**
 * AI文章（任意）。ANTHROPIC_API_KEY が無い場合はルールの文章をそのまま使う。
 * 送るのは集計済みの数値と定型文だけで、個人名・取引先名・明細は送らない。
 * 失敗した場合もルールの文章を使う（画面に「ルールベース」と表示）。
 */
type CardText = { title: string; finding: string; recommendation: string; evidence: { label: string; value: string }[]; ruleKey: string };

export async function polishCardText(c: CardText): Promise<{ finding: string; recommendation: string; source: "RULE" | "LLM" }> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key || process.env.LLM_DRIVER === "off") return { finding: c.finding, recommendation: c.recommendation, source: "RULE" };
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({
        model: process.env.LLM_MODEL || "claude-haiku-5-5",
        max_tokens: 400,
        system:
          "あなたは中小企業の経理責任者を補佐します。与えられた指摘と根拠の数値だけを使い、経営者が読みやすい日本語に整えてください。数値を変えたり新しい数値を作ったりしないでください。税務上の判断は断定せず『税理士に確認』としてください。支払い・契約・予算変更を実行したとは書かないでください。JSON {\"finding\":\"…\",\"recommendation\":\"…\"} だけを返してください。",
        messages: [{ role: "user", content: JSON.stringify({ title: c.title, finding: c.finding, recommendation: c.recommendation, evidence: c.evidence }) }],
      }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) throw new Error(String(res.status));
    const j = (await res.json()) as { content?: { type: string; text?: string }[] };
    const text = j.content?.find((x) => x.type === "text")?.text ?? "";
    const parsed = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1)) as { finding?: string; recommendation?: string };
    if (!parsed.finding || !parsed.recommendation) throw new Error("empty");
    // 元の根拠の数値が文章から消えていないか（数値の捏造・欠落の簡易チェック）
    return { finding: parsed.finding.slice(0, 600), recommendation: parsed.recommendation.slice(0, 600), source: "LLM" };
  } catch {
    return { finding: c.finding, recommendation: c.recommendation, source: "RULE" };
  }
}
