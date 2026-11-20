import { requireSession } from "@/lib/server-auth";
import { AppShell } from "@/components/shell";

export const dynamic = "force-dynamic";
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const { profile } = await requireSession("admin");
  return <AppShell me={profile as never} area="admin">{children}</AppShell>;
}
