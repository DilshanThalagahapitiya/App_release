import { getEnv } from "@/lib/env";
import { resolveRequest } from "@/services/devices";

export const metadata = { title: "Share your device ID", robots: { index: false, follow: false } };

export default async function Page({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const r = await resolveRequest(await getEnv(), token);
  if (!r) return (<div className="card space-y-2 p-6 text-center"><h1 className="text-xl font-semibold">This link has expired</h1><p>Please ask the person who sent it for a new one.</p></div>);
  return (
    <div className="space-y-4">
      <div className="card space-y-3 p-6">
        <p className="text-sm muted">{r.org_name}</p>
        <h1 className="text-2xl font-semibold">Let {r.org_name} set up the test app on your iPhone</h1>
        <p>We need your iPhone&apos;s ID number. This button sends it for you — you don&apos;t need to find or type anything.</p>
        <a href={`/u/${token}/profile.mobileconfig`} className="block rounded-xl bg-[var(--accent)] px-4 py-4 text-center text-lg font-semibold" style={{ color: "var(--accent-text)", textDecoration: "none" }}>Step 1: Tap here to start</a>
      </div>
      <div className="card space-y-3 p-6">
        <h2 className="text-lg font-semibold">What happens next</h2>
        <ol className="list-decimal space-y-3 pl-6">
          <li>Safari asks <b>&quot;Allow this website to download a configuration profile?&quot;</b> Tap <b>Allow</b>, then <b>Close</b>.</li>
          <li>Open the <b>Settings</b> app (grey gear icon). At the top you&apos;ll see <b>&quot;Profile Downloaded&quot;</b>. Tap it.</li>
          <li>Tap <b>Install</b> (top right). Enter your phone passcode if asked, then tap <b>Install</b> again and once more to confirm.</li>
          <li>Safari opens by itself and says thank you. That&apos;s all — you&apos;re done.</li>
        </ol>
        <p className="text-sm text-[var(--text-2)]">The screen may say <b>&quot;Not Signed&quot;</b> — that is normal. This only shares your device ID, phone model and iOS version. It does not read your photos, messages or contacts, and it installs no apps.</p>
        <p className="text-sm text-[var(--text-2)]">You can remove it afterwards: Settings → General → VPN &amp; Device Management → tap it → Remove Profile.</p>
      </div>
      <p className="text-center text-sm muted">Open this page in <b>Safari</b> on the iPhone.</p>
    </div>
  );
}
