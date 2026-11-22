"use client";
import * as React from "react";
import { Callout, Card } from "./ui";
import { CopyButton } from "./features";

export const DEVICES: [string, string][] = [
  ["iphone15pro", "iPhone 15 Pro"], ["iphone15promax", "iPhone 15 Pro Max"], ["iphone16pro", "iPhone 16 Pro"], ["iphone16promax", "iPhone 16 Pro Max"], ["iphone17pro", "iPhone 17 Pro"], ["iphone17promax", "iPhone 17 Pro Max"],
  ["iphone14pro", "iPhone 14 Pro"], ["iphone13pro", "iPhone 13 Pro"], ["iphone12", "iPhone 12"], ["iphone11pro", "iPhone 11 Pro"],
  ["ipadair4thgeneration", "iPad Air (4th gen)"], ["ipadpro129inch5thgeneration", "iPad Pro 12.9\" (5th gen)"], ["ipad9thgeneration", "iPad (9th gen)"], ["ipadmini6thgeneration", "iPad mini (6th gen)"],
];

export const PREVIEW_LABEL: Record<string, string> = { pending: "Pending", uploading: "Uploading", processing: "Processing", ready: "Ready", failed: "Failed", expired: "Expired", disabled: "Disabled", deleted: "Deleted" };
const ORDER = ["pending", "uploading", "processing", "ready"];

/** Pending → Uploading → Processing → Ready, with the failure shown on the step where it stopped. */
export function PreviewSteps({ status, detail }: { status: string; detail?: string | null }) {
  const idx = ORDER.indexOf(status === "expired" || status === "disabled" ? "ready" : status);
  return (
    <div className="space-y-2">
      <ol className="flex items-center gap-1.5 text-[12px]" aria-label="Preview progress">
        {ORDER.map((s, i) => { const done = status !== "failed" && idx > i; const now = status !== "failed" && idx === i;
          return (<li key={s} className="flex flex-1 items-center gap-1.5"><span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold ${done || (now && s === "ready") ? "bg-[var(--good-soft)] text-[var(--good)]" : now ? "bg-[var(--accent-soft)] text-[var(--accent)]" : "bg-[var(--surface-2)] text-[var(--text-3)]"}`}>{done || (now && s === "ready") ? "✓" : i + 1}</span><span className={now ? "font-semibold" : "text-[var(--text-3)]"}>{PREVIEW_LABEL[s]}</span>{i < ORDER.length - 1 && <span className="h-px flex-1 bg-[var(--border)]" />}</li>); })}
      </ol>
      {(status === "uploading" || status === "processing") && <div className="h-1.5 overflow-hidden rounded-full bg-[var(--surface-2)]" role="progressbar" aria-label="Working"><div className="h-full w-1/3 animate-pulse rounded-full bg-[var(--accent)]" /></div>}
      {detail && <p className={`text-[13px] ${status === "failed" ? "text-[var(--bad)]" : "text-[var(--text-2)]"}`}>{detail}</p>}
    </div>
  );
}

const CMD1 = "xcodebuild -workspace YourApp.xcworkspace -scheme YourApp -sdk iphonesimulator -configuration Debug -derivedDataPath ./Build build";
const CMD2 = "cd ./Build/Build/Products/Debug-iphonesimulator\nditto -c -k --keepParent YourApp.app YourApp.zip";
export function XcodeInstructions() {
  return (
    <Card title="How to make a simulator build in Xcode">
      <ol className="list-decimal space-y-3 pl-5 text-[13px]">
        <li>Build the app for the <b>iOS Simulator</b> (not a device). In Terminal, in your project folder:
          <pre className="mt-1.5 overflow-x-auto rounded-lg bg-[var(--surface-2)] p-3 text-xs"><code>{CMD1}</code></pre><div className="mt-1"><CopyButton text={CMD1} label="Copy" /></div>
          <p className="mt-1 text-xs muted">Use <code>-project YourApp.xcodeproj</code> instead of <code>-workspace</code> if you have no workspace. An Apple Silicon Mac builds an arm64 simulator app, which is what Appetize recommends.</p></li>
        <li>Find the finished app. It is the <code>.app</code> <b>folder</b> in <code>./Build/Build/Products/Debug-iphonesimulator/</code>, then compress it:
          <pre className="mt-1.5 overflow-x-auto rounded-lg bg-[var(--surface-2)] p-3 text-xs"><code>{CMD2}</code></pre><div className="mt-1"><CopyButton text={CMD2} label="Copy" /></div>
          <p className="mt-1 text-xs muted"><code>zip -r YourApp.zip YourApp.app</code> also works. A <code>.tar.gz</code> is accepted too, but a ZIP is checked more thoroughly.</p></li>
        <li>Upload that ZIP here. It is sent to Appetize automatically and you get a preview link to share.</li>
      </ol>
      <div className="mt-3"><Callout tone="warn" title="Device builds do not work">An <code>.ipa</code> (built with <code>-sdk iphoneos</code> or exported from Xcode&apos;s Archive) cannot run in the simulator and is rejected. Only a Simulator <code>.app</code> works.</Callout></div>
    </Card>
  );
}
