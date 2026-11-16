import { describe, expect, it } from "vitest";
import { contentsDer } from "../src/pdf/sign";

// A signature's /Contents is its CMS DER, hex, zero-padded to the reserved size. The DER must be cut at the
// length in its own header: trimming trailing "0"s also cut signatures whose last byte ends in a zero digit
// (about 1 in 16), so a store-signed PDF intermittently showed no issuer and read as not intact.
describe("contentsDer", () => {
  it("keeps a signature whose last bytes are zero", () => {
    expect(contentsDer("3003020100" + "0".repeat(40)).toString("hex")).toBe("3003020100");
    expect(contentsDer("3003020110" + "0".repeat(8)).toString("hex")).toBe("3003020110");
  });
  it("reads long-form lengths", () => {
    const body = "04820100" + "ab".repeat(256); // OCTET STRING, 256 bytes
    const der = "3082" + (body.length / 2).toString(16).padStart(4, "0") + body;
    expect(contentsDer(der + "0".repeat(64)).toString("hex")).toBe(der);
  });
  it("refuses what is not a whole CMS signature", () => {
    expect(() => contentsDer("")).toThrow();
    expect(() => contentsDer("0400")).toThrow(/CMS/);
    expect(() => contentsDer("3010" + "00")).toThrow(/cut short/);
  });
});
