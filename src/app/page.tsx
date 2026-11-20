import { redirect } from "next/navigation";
import { requireSession } from "@/lib/server-auth";
export const dynamic = "force-dynamic";
export default async function Home() {
  const { profile } = await requireSession("any");
  redirect(profile.portal === "admin" ? "/app" : "/portal");
}
