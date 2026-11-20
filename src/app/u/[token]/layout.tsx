export const dynamic = "force-dynamic";
export default function Layout({ children }: { children: React.ReactNode }) {
  return <div className="mx-auto min-h-screen max-w-lg px-4 py-6 text-[17px]">{children}</div>;
}
