import "server-only";
/** 稼働明細の PDF（日本語・Noto Sans JP）。権限は getStatement で判定 */
import path from "node:path";
import { Document, Font, Page, renderToBuffer, StyleSheet, Text, View } from "@react-pdf/renderer";
import type { DB } from "@/db";
import type { Actor } from "@/lib/access";
import { formatDate } from "@/lib/dates";
import { formatYen } from "@/lib/money";
import { getStatement } from "./statements";

let fontsRegistered = false;
export function registerFonts() {
  if (fontsRegistered) return;
  const base = path.join(process.cwd(), "node_modules", "@expo-google-fonts", "noto-sans-jp");
  Font.register({
    family: "NotoSansJP",
    fonts: [
      { src: path.join(base, "400Regular", "NotoSansJP_400Regular.ttf"), fontWeight: 400 },
      { src: path.join(base, "700Bold", "NotoSansJP_700Bold.ttf"), fontWeight: 700 },
    ],
  });
  Font.registerHyphenationCallback((word) => Array.from(word).flatMap((c) => [c, ""]));
  fontsRegistered = true;
}

const navy = "#1f3052";
export const pdfStyles = StyleSheet.create({
  page: { fontFamily: "NotoSansJP", fontSize: 9.5, padding: 40, color: "#1a2333", lineHeight: 1.5 },
  title: { fontSize: 18, fontWeight: 700, textAlign: "center", letterSpacing: 6, color: navy, marginBottom: 14 },
  draft: { position: "absolute", top: 300, left: 120, fontSize: 56, color: "#d0d6e0", transform: "rotate(-30deg)" },
  row: { flexDirection: "row", justifyContent: "space-between" },
  name: { fontSize: 13, fontWeight: 700, borderBottomWidth: 1, borderBottomColor: navy, paddingBottom: 2, marginBottom: 4 },
  th: { flexDirection: "row", backgroundColor: "#e3e9f3", fontWeight: 700, borderBottomWidth: 1, borderBottomColor: navy },
  tr: { flexDirection: "row", borderBottomWidth: 0.5, borderBottomColor: "#c6d2e6" },
  sums: { marginTop: 8, marginLeft: "auto", width: "50%" },
  sumRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 2, borderBottomWidth: 0.5, borderBottomColor: "#c6d2e6" },
  total: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 4, fontSize: 12, fontWeight: 700, borderBottomWidth: 1, borderBottomColor: navy },
  small: { fontSize: 8, color: "#5b6678" },
  box: { marginTop: 14, borderWidth: 0.5, borderColor: "#9cb0d2", padding: 8 },
});
const s = pdfStyles;
const W = ["13%", "45%", "9%", "15%", "18%"];

export async function statementPdf(db: DB, actor: Actor, id: string) {
  registerFonts();
  const st = await getStatement(db, actor, id);
  const snap = (st.s.snapshot ?? {}) as { companyName?: string; taxMode?: string; withholdingEnabled?: boolean };
  const final = st.s.status === "CONFIRMED" || st.s.status === "PUBLISHED";
  const doc = (
    <Document title={`稼働明細 ${st.s.month}`}>
      <Page size="A4" style={s.page}>
        {!final && <Text style={s.draft}>{st.s.status === "SUPERSEDED" ? "訂正済み旧版" : "下書き"}</Text>}
        <Text style={s.title}>稼働明細書</Text>
        <View style={s.row}>
          <View style={{ width: "55%" }}>
            <Text style={s.name}>{st.driverName} 様</Text>
            <Text>対象月: {st.s.month.replace("-", "年")}月</Text>
            <Text>版: 第{st.s.version}版{st.s.correctionReason ? `（訂正理由: ${st.s.correctionReason}）` : ""}</Text>
          </View>
          <View style={{ width: "40%" }}>
            <Text style={{ fontWeight: 700 }}>{snap.companyName ?? ""}</Text>
            <Text>支払予定日: {formatDate(st.s.payDueDate)}</Text>
            <Text style={s.small}>確定日: {st.s.confirmedAt ? st.s.confirmedAt.toISOString().slice(0, 10) : "未確定"}</Text>
          </View>
        </View>
        <View style={{ marginTop: 14 }}>
          <View style={s.th}>
            {["日付", "内容", "数量", "単価", "金額"].map((h, i) => <Text key={h} style={{ width: W[i], padding: 4, textAlign: i >= 2 ? "right" : "left" }}>{h}</Text>)}
          </View>
          {st.lines.map(({ l }) => (
            <View key={l.id} style={s.tr} wrap={false}>
              <Text style={{ width: W[0], padding: 4 }}>{l.workDate ? formatDate(l.workDate) : ""}</Text>
              <Text style={{ width: W[1], padding: 4 }}>{l.description}</Text>
              <Text style={{ width: W[2], padding: 4, textAlign: "right" }}>{Number(l.quantity)}{l.unit}</Text>
              <Text style={{ width: W[3], padding: 4, textAlign: "right" }}>{formatYen(l.unitPrice)}</Text>
              <Text style={{ width: W[4], padding: 4, textAlign: "right" }}>{formatYen(l.amount)}</Text>
            </View>
          ))}
        </View>
        <View style={s.sums}>
          <View style={s.sumRow}><Text>稼働分（税抜）</Text><Text>{formatYen(st.s.workAmount)}</Text></View>
          {st.s.adjustmentAmount !== 0 && <View style={s.sumRow}><Text>調整</Text><Text>{formatYen(st.s.adjustmentAmount)}</Text></View>}
          <View style={s.sumRow}><Text>消費税{snap.taxMode === "INCLUSIVE" ? "（内税）" : snap.taxMode === "EXEMPT" ? "（対象外）" : ""}</Text><Text>{formatYen(st.s.taxAmount)}</Text></View>
          {st.s.withholdingAmount > 0 && <View style={s.sumRow}><Text>源泉徴収</Text><Text>-{formatYen(st.s.withholdingAmount)}</Text></View>}
          {st.s.expenseAmount > 0 && <View style={s.sumRow}><Text>立替経費</Text><Text>{formatYen(st.s.expenseAmount)}</Text></View>}
          <View style={s.total}><Text>お支払額</Text><Text>{formatYen(st.s.payAmount)}</Text></View>
        </View>
        <View style={s.box}>
          <Text style={s.small}>この明細は承認済みの日報と、適用期間内の単価・承認済みの調整から作成しています。内容に疑問がある場合はドライバー用ページの「問い合わせ」からご連絡ください。</Text>
        </View>
      </Page>
    </Document>
  );
  return { buffer: await renderToBuffer(doc), name: `statement_${st.s.month}_v${st.s.version}.pdf` };
}
