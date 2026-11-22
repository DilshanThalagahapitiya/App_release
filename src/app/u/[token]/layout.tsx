import { AppFrame } from "@/components/app-frame";

export const dynamic = "force-dynamic";
export default function Layout({ children }: { children: React.ReactNode }) {
  return <AppFrame title="Crede Releases" tabs={[{ id: "u", label: "", icon: "install", content: <div className="text-[17px]">{children}</div> }]} />;
}
