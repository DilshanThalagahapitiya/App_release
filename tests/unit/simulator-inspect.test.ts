import { describe, expect, it } from "vitest";
import { bytesSource } from "../../src/lib/ipa-inspect";
import { detectArchiveKind, inspectSimulatorTarGz, inspectSimulatorZip, SimulatorInspectError } from "../../src/lib/simulator-inspect";
import { enc, macho, plist, simInfo, simZip, tarGz, zip } from "../helpers/archives";

const streamOf = (b: Uint8Array) => async () => new Response(b as unknown as BodyInit).body as ReadableStream<Uint8Array>;
const code = async (p: Promise<unknown>) => { try { await p; return "none"; } catch (e) { return e instanceof SimulatorInspectError ? e.code : "other:" + (e as Error).message; } };

describe("simulator ZIP inspection", () => {
  it("reads a valid Apple Silicon simulator build", async () => {
    const r = await inspectSimulatorZip(bytesSource(simZip(["arm64"])));
    expect(r.fileType).toBe("zip");
    expect(r.app).toEqual({ name: "Sim App", bundleIdentifier: "com.example.sim", version: "2.0.1", buildNumber: "42", minimumOSVersion: "16.0" });
    expect(r.architectures).toEqual(["arm64"]); expect(r.warnings).toEqual([]);
  });
  it("reads a universal (fat) executable and warns for x86_64-only builds", async () => {
    expect((await inspectSimulatorZip(bytesSource(simZip(["arm64", "x86_64"])))).architectures).toEqual(["arm64", "x86_64"]);
    const intel = await inspectSimulatorZip(bytesSource(simZip(["x86_64"])));
    expect(intel.warnings.join(" ")).toContain("arm64");
  });
  it("finds the .app one folder deep and ignores __MACOSX", async () => {
    const z = zip([{ name: "__MACOSX/Dist/SimApp.app/Info.plist", data: enc("junk") }, { name: "Dist/SimApp.app/Info.plist", data: enc(simInfo()) }, { name: "Dist/SimApp.app/SimApp", data: macho(["arm64"]) }]);
    expect((await inspectSimulatorZip(bytesSource(z))).app.bundleIdentifier).toBe("com.example.sim");
  });
  it("rejects a device IPA with a clear explanation", async () => {
    const ipa = zip([{ name: "Payload/App.app/Info.plist", data: enc(plist({ CFBundleIdentifier: "com.x", CFBundleSupportedPlatforms: ["iPhoneOS"] })) }]);
    expect(await code(inspectSimulatorZip(bytesSource(ipa)))).toBe("SIM_IS_IPA");
    try { await inspectSimulatorZip(bytesSource(ipa)); } catch (e) { expect((e as Error).message).toMatch(/device IPA.*iphonesimulator/s); }
  });
  it("rejects a device-built .app, a missing app, a bad bundle and non-archives", async () => {
    expect(await code(inspectSimulatorZip(bytesSource(simZip(["arm64"], { CFBundleSupportedPlatforms: ["iPhoneOS"], DTPlatformName: "iphoneos" }))))).toBe("SIM_DEVICE_BUILD");
    expect(await code(inspectSimulatorZip(bytesSource(zip([{ name: "readme.txt", data: enc("hi") }]))))).toBe("SIM_NO_APP");
    expect(await code(inspectSimulatorZip(bytesSource(zip([{ name: "A.app/Info.plist", data: enc(plist({ CFBundleSupportedPlatforms: ["iPhoneSimulator"] })) }]))))).toBe("SIM_NO_BUNDLE_ID");
    expect(await code(inspectSimulatorZip(bytesSource(enc("this is definitely not a zip file at all"))))).toBe("SIM_NOT_ARCHIVE");
  });
  it("rejects code with no usable simulator architecture", async () => {
    const z = zip([{ name: "A.app/Info.plist", data: enc(simInfo({ CFBundleExecutable: "A" })) }, { name: "A.app/A", data: new Uint8Array([0xce, 0xfa, 0xed, 0xfe, 7, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]) }]);
    expect(await code(inspectSimulatorZip(bytesSource(z)))).toBe("SIM_BAD_ARCH");
  });
});

describe("simulator TAR.GZ inspection", () => {
  it("reads a valid tar.gz", async () => {
    const t = tarGz([{ name: "SimApp.app/Info.plist", data: enc(simInfo()) }, { name: "SimApp.app/SimApp", data: macho(["arm64"]) }]);
    expect(detectArchiveKind(t)).toBe("tar.gz");
    const r = await inspectSimulatorTarGz(streamOf(t));
    expect(r.app.bundleIdentifier).toBe("com.example.sim"); expect(r.architectures).toEqual(["arm64"]); expect(r.fullyInspected).toBe(true);
  });
  it("rejects an IPA packed as tar.gz, an archive without an app, and garbage", async () => {
    expect(await code(inspectSimulatorTarGz(streamOf(tarGz([{ name: "Payload/App.app/Info.plist", data: enc(simInfo()) }]))))).toBe("SIM_IS_IPA");
    expect(await code(inspectSimulatorTarGz(streamOf(tarGz([{ name: "notes.txt", data: enc("x") }]))))).toBe("SIM_NO_APP");
    expect(await code(inspectSimulatorTarGz(streamOf(enc("not gzip data"))))).toBe("SIM_NOT_ARCHIVE");
  });
});
