export const dynamic = "force-dynamic";
export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return <div className="mx-auto min-h-screen max-w-lg px-4 py-6">{children}</div>;
}
