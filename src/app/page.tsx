import { redirect } from "next/navigation";
import { getActor, homeFor } from "@/lib/session";

export default async function Home() {
  const a = await getActor();
  if (!a) redirect("/login");
  redirect(homeFor(a));
}
