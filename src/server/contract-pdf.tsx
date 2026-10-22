import "server-only";
/** 契約書の PDF（締結前は「下書き」等の透かし入り）。権限は getContract で判定 */
import { Document, Page, renderToBuffer, Text, View } from "@react-pdf/renderer";
import type { DB } from "@/db";
import type { Actor } from "@/lib/access";
import { L } from "@/lib/labels";
import { getContract } from "./contracts";
import { pdfStyles as s, registerFonts } from "./statement-pdf";

export async function contractPdf(db: DB, actor: Actor, id: string) {
  registerFonts();
  const x = await getContract(db, actor, id);
  const mark = x.c.status === "SIGNED" || x.c.status === "ENDED" ? null : L.contract[x.c.status][0];
  const doc = (
    <Document title={x.c.title}>
      <Page size="A4" style={{ ...s.page, fontSize: 10.5, lineHeight: 1.8 }}>
        {mark && <Text style={s.draft} fixed>{mark}</Text>}
        <Text style={s.title}>{x.c.title}</Text>
        <View><Text>{x.c.renderedBody}</Text></View>
        <Text style={{ ...s.small, marginTop: 16 }} fixed render={({ pageNumber, totalPages }) => `第${x.c.revision}版・テンプレート「${x.template.name}」第${x.template.version}版　${pageNumber}/${totalPages}`} />
      </Page>
    </Document>
  );
  return { buffer: await renderToBuffer(doc), name: `contract_${x.c.id.slice(0, 8)}_r${x.c.revision}.pdf` };
}
