import Link from "next/link";
import { logoutAction } from "@/app/login/actions";

export const metadata = { title: "その他" };

const ITEMS = [
  { href: "/d/statements", label: "稼働明細", desc: "毎月の明細の確認・PDF/Excel・問い合わせ" },
  { href: "/d/expenses", label: "立替経費", desc: "燃料代などの立替の申請" },
  { href: "/d/contracts", label: "契約書", desc: "締結済みの業務委託契約書" },
  { href: "/d/profile", label: "メールアドレス・登録情報", desc: "リマインドの送信先の登録" },
];

export default function MorePage() {
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold text-navy-900">その他</h1>
      <ul className="space-y-2">
        {ITEMS.map((i) => (
          <li key={i.href}><Link href={i.href} className="block rounded-lg border border-line bg-white p-4"><span className="block text-base font-bold text-navy-900">{i.label} ›</span><span className="text-sm text-muted">{i.desc}</span></Link></li>
        ))}
      </ul>
      <form action={logoutAction}><button type="submit" className="w-full rounded-lg border border-line bg-white py-3 font-bold text-navy-800">ログアウト</button></form>
    </div>
  );
}
