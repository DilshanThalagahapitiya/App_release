import { requireSession } from "@/lib/server-auth";
import { AppShell } from "@/components/shell";

export const dynamic = "force-dynamic";
export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const { profile } = await requireSession("any");
  return <AppShell me={profile as never} area="customer">{children}</AppShell>;
}
