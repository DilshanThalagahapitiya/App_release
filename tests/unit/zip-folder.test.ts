import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildZip, crc32, isMachO, appFromFileList, collectApp } from "../../src/lib/zip-folder";
import { bytesSource } from "../../src/lib/ipa-inspect";
import { inspectSimulatorZip } from "../../src/lib/simulator-inspect";
import { enc, macho, simInfo } from "../helpers/archives";

const blob = (b: Uint8Array) => new Blob([b as unknown as BlobPart]);
const files = () => [
  { path: "SimApp.app/Info.plist", file: blob(enc(simInfo())) },
  { path: "SimApp.app/SimApp", file: blob(macho(["arm64"])) },
  { path: "SimApp.app/Assets/readme.txt", file: blob(enc("hello hello hello hello hello hello hello hello hello hello hello hello hello hello hello hello")) },
];
const haveUnzip = (() => { try { execFileSync("unzip", ["-v"], { stdio: "ignore" }); return true; } catch { return false; } })();

describe("zip-folder", () => {
  it("computes CRC-32 correctly and recognises Mach-O files", () => {
    expect(crc32(enc("123456789"))).toBe(0xcbf43926);
    expect(isMachO(macho(["arm64"]))).toBe(true); expect(isMachO(macho(["arm64", "x86_64"]))).toBe(true); expect(isMachO(enc("plain text"))).toBe(false);
  });
  it("produces a ZIP our simulator inspector accepts", async () => {
    const z = new Uint8Array(await (await buildZip(files())).arrayBuffer());
    const r = await inspectSimulatorZip(bytesSource(z));
    expect(r.app.bundleIdentifier).toBe("com.example.sim"); expect(r.architectures).toEqual(["arm64"]); expect(r.warnings).toEqual([]);
  });
  it.skipIf(!haveUnzip)("is a valid archive for the system unzip, with CRCs intact and the executable bit kept", async () => {
    const dir = mkdtempSync(join(tmpdir(), "zipf-")); const zp = join(dir, "a.zip");
    writeFileSync(zp, new Uint8Array(await (await buildZip(files())).arrayBuffer()));
    expect(existsSync(zp)).toBe(true);
    expect(execFileSync("unzip", ["-t", zp]).toString()).toContain("No errors detected");
    const listing = execFileSync("unzip", ["-Z", zp]).toString();
    expect(listing).toMatch(/-rwxr-xr-x.*SimApp\.app\/SimApp\n/);          // Mach-O keeps 0755
    expect(listing).toMatch(/-rw-r--r--.*SimApp\.app\/Info\.plist\n/);
  });
  it("finds the .app in a chosen folder and rejects other folders", () => {
    const f = (p: string) => Object.assign(new File(["x"], p.split("/").pop()!), { webkitRelativePath: p });
    const ok = appFromFileList([f("MyApp.app/Info.plist"), f("MyApp.app/MyApp"), f("MyApp.app/.DS_Store")] as unknown as FileList);
    expect("files" in ok && ok.files.map((x) => x.path)).toEqual(["MyApp.app/Info.plist", "MyApp.app/MyApp"]);
    expect("error" in appFromFileList([f("Docs/readme.txt")] as unknown as FileList)).toBe(true);
    expect("error" in appFromFileList([f("MyApp.app/Other")] as unknown as FileList)).toBe(true);
  });
  it("collects a dropped directory entry (and a parent folder holding one .app)", async () => {
    const file = (name: string, data = "x") => ({ isFile: true, isDirectory: false, name, fullPath: name, file: (ok: (f: File) => void) => ok(new File([data], name)) });
    const dir = (name: string, kids: unknown[]) => ({ isFile: false, isDirectory: true, name, fullPath: name, createReader: () => { let done = false; return { readEntries: (ok: (e: unknown[]) => void) => { ok(done ? [] : kids); done = true; } }; } });
    const app = dir("Demo.app", [file("Info.plist"), file(".DS_Store"), dir("Assets", [file("a.png")])]);
    const r1 = await collectApp(app);
    expect("files" in r1 && r1.files.map((x) => x.path).sort()).toEqual(["Demo.app/Assets/a.png", "Demo.app/Info.plist"]);
    const r2 = await collectApp(dir("Debug-iphonesimulator", [app, dir("Demo.swiftmodule", [])]));
    expect("files" in r2 && r2.name).toBe("Demo");
    expect("error" in (await collectApp(dir("Empty", [])))).toBe(true);
    expect("error" in (await collectApp(file("x.zip")))).toBe(true);
  });
});
