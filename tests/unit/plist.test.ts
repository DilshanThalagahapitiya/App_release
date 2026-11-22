import { describe, expect, it } from "vitest";
import { parseBinaryPlist, parsePlist, parseXmlPlist } from "../../src/lib/ipa-inspect";

// Produced by `plutil -convert binary1` from the XML in the next test (Name has non-ASCII characters).
const BPLIST = "62706c6973743030d50102030405060708090a53426967544e616d65524f6e5f1012434642756e646c654964656e7469666965725e554944657669636546616d696c7912000111706300dc006e00ef095c636f6d2e61636d652e62696ea20b0c100110020813171c1f3443484f505d60620000000000000101000000000000000d00000000000000000000000000000064";
const hex = (h: string) => Uint8Array.from(h.match(/../g)!.map((x) => parseInt(x, 16)));

describe("plist parsing", () => {
  it("parses a binary plist (ints, bool, unicode string, array, dict)", () => {
    expect(parseBinaryPlist(hex(BPLIST))).toEqual({ CFBundleIdentifier: "com.acme.bin", UIDeviceFamily: [1, 2], On: true, Name: "Ünï", Big: 70000 });
    expect(parsePlist(hex(BPLIST))).toMatchObject({ CFBundleIdentifier: "com.acme.bin" });
  });
  it("parses the same document as XML", () => {
    const xml = '<?xml version="1.0"?><!DOCTYPE plist><plist version="1.0"><dict><key>CFBundleIdentifier</key><string>com.acme.bin</string><key>UIDeviceFamily</key><array><integer>1</integer><integer>2</integer></array><key>On</key><true/><key>Name</key><string>Ünï</string><key>Big</key><integer>70000</integer><key>E</key><dict/><key>S</key><string/></dict></plist>';
    expect(parseXmlPlist(xml)).toEqual({ CFBundleIdentifier: "com.acme.bin", UIDeviceFamily: [1, 2], On: true, Name: "Ünï", Big: 70000, E: {}, S: "" });
  });
  it("rejects corrupt binary data without hanging", () => {
    expect(() => parseBinaryPlist(new Uint8Array(100))).toThrow();
    const bad = hex(BPLIST); bad[bad.length - 9] = 0xff; // wrong top object index
    expect(() => parseBinaryPlist(bad)).toThrow();
  });
});
