export const metadata = { title: "Thank you", robots: { index: false, follow: false } };
export default function Done() {
  return (<div className="card space-y-3 p-8 text-center"><div className="text-5xl" aria-hidden>✓</div><h1 className="text-2xl font-semibold">Thank you!</h1><p>Your device ID was sent. You can close this page. You will receive an install link soon.</p><p className="text-sm muted">You can delete the profile in Settings → General → VPN &amp; Device Management.</p></div>);
}
