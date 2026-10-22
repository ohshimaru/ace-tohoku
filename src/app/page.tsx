import { redirect } from "next/navigation";
import { getActor } from "@/lib/session";

export default async function Home() {
  const a = await getActor();
  if (!a) redirect("/login");
  redirect(a.role === "DRIVER" ? "/d" : "/app");
}
