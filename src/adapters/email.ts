/** メール送信（console: 送らず記録のみ / smtp / resend）。宛先の許可リストで検証環境の誤送信を防ぐ */
export type EmailDriver = "console" | "smtp" | "resend";
export type Mail = { to: string; subject: string; text: string };

export function emailDriver(): EmailDriver {
  const d = process.env.EMAIL_DRIVER;
  return d === "smtp" || d === "resend" ? d : "console";
}

export function allowedRecipient(to: string): boolean {
  const list = (process.env.EMAIL_ALLOWLIST ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  if (!list.length) return true;
  const t = to.toLowerCase();
  return list.some((x) => (x.startsWith("@") ? t.endsWith(x) : t === x));
}

export class PermanentEmailError extends Error {}

export async function sendMail(m: Mail): Promise<{ driver: EmailDriver }> {
  const driver = emailDriver();
  if (!allowedRecipient(m.to)) throw new PermanentEmailError("送信先が許可リスト（EMAIL_ALLOWLIST）にありません");
  if (driver === "console") return { driver };
  const from = process.env.EMAIL_FROM;
  if (!from) throw new PermanentEmailError("EMAIL_FROM が未設定です");
  if (driver === "smtp") {
    const nodemailer = await import("nodemailer");
    const t = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 465),
      secure: Number(process.env.SMTP_PORT || 465) === 465,
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    });
    await t.sendMail({ from, to: m.to, subject: m.subject, text: m.text });
    return { driver };
  }
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY ?? ""}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from, to: [m.to], subject: m.subject, text: m.text }),
  });
  if (res.status >= 400 && res.status < 500 && res.status !== 429) throw new PermanentEmailError(`送信が拒否されました（${res.status}）`);
  if (!res.ok) throw new Error(`一時的な送信エラー（${res.status}）`);
  return { driver };
}
