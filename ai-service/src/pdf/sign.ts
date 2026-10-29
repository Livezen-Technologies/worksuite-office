// Digital signatures (PAdES baseline, adbe.pkcs7.detached) with a certificate file (.p12/.pfx), and checking the
// signatures a PDF already has. The PDF gets a signature field whose /Contents is a placeholder; @signpdf then
// fills it with a CMS signature (node-forge) over every byte but the placeholder. Signing is the last step: any
// later change that rewrites the file breaks the signature, as it should.
import { createHash } from "node:crypto";
import forge from "node-forge";
import { SignPdf } from "@signpdf/signpdf";
import { P12Signer } from "@signpdf/signer-p12";
import { DEFAULT_BYTE_RANGE_PLACEHOLDER, SUBFILTER_ADOBE_PKCS7_DETACHED } from "@signpdf/utils";
import { PDFArray, PDFDocument, PDFHexString, PDFName, PDFNumber, PDFString, rgb, StandardFonts } from "@cantoo/pdf-lib";
import { ApiError } from "../errors";

const SIGNATURE_LENGTH = 16384;

export interface Certificate { name: string; email?: string; issuer: string; notBefore: string; notAfter: string }

function nameOf(attrs: forge.pki.CertificateField[]): string {
  const get = (n: string) => attrs.find((a) => a.shortName === n || a.name === n)?.value as string | undefined;
  return get("CN") || get("O") || get("emailAddress") || "Unknown";
}

/** The signing certificate of a .p12/.pfx, checked to open with the password and to be valid today. */
export function readP12(p12: Buffer, passphrase: string, now = new Date()): Certificate {
  let bags;
  try {
    const asn1 = forge.asn1.fromDer(forge.util.createBuffer(p12.toString("binary")));
    const pkcs12 = forge.pkcs12.pkcs12FromAsn1(asn1, false, passphrase);
    bags = { certs: pkcs12.getBags({ bagType: forge.pki.oids.certBag })[forge.pki.oids.certBag] || [],
      keys: (pkcs12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag })[forge.pki.oids.pkcs8ShroudedKeyBag] || [])
        .concat(pkcs12.getBags({ bagType: forge.pki.oids.keyBag })[forge.pki.oids.keyBag] || []) };
  } catch (e) {
    const msg = (e as Error).message || "";
    throw new ApiError("bad_request", /mac|password|decrypt|invalid/i.test(msg) ? "The certificate password is not right" : "This is not a certificate file (.p12 or .pfx)", { reason: /mac|password|decrypt/i.test(msg) ? "password_incorrect" : "not_a_certificate" });
  }
  if (!bags.keys.length || !bags.keys[0].key) throw new ApiError("bad_request", "The certificate file has no private key, so it cannot sign", { reason: "no_key" });
  const key = bags.keys[0].key as forge.pki.rsa.PrivateKey;
  // the certificate that goes with the key
  const cert = bags.certs.map((b) => b.cert!).find((c) => {
    const pub = c.publicKey as forge.pki.rsa.PublicKey;
    return pub.n && key.n && pub.n.equals(key.n);
  }) || bags.certs[0]?.cert;
  if (!cert) throw new ApiError("bad_request", "The certificate file has no certificate", { reason: "no_certificate" });
  if (now < cert.validity.notBefore || now > cert.validity.notAfter) {
    throw new ApiError("bad_request", "The certificate is not valid today", { reason: "certificate_expired", notBefore: cert.validity.notBefore.toISOString(), notAfter: cert.validity.notAfter.toISOString() });
  }
  const email = cert.subject.attributes.find((a) => a.shortName === "E" || a.name === "emailAddress")?.value as string | undefined;
  return { name: nameOf(cert.subject.attributes), ...(email ? { email } : {}), issuer: nameOf(cert.issuer.attributes),
    notBefore: cert.validity.notBefore.toISOString(), notAfter: cert.validity.notAfter.toISOString() };
}

export interface SignOptions { reason?: string; location?: string; contact?: string; visible?: { page: number } }

/** The signed PDF. The document is saved without object streams so the placeholder can be found and filled. */
export async function signPdf(doc: PDFDocument, p12: Buffer, passphrase: string, opts: SignOptions = {}, now = new Date()): Promise<{ pdf: Buffer; signer: Certificate }> {
  const signer = readP12(p12, passphrase, now);
  const ctx = doc.context;
  const pages = doc.getPages();
  const pageIndex = opts.visible ? opts.visible.page - 1 : 0;
  if (pageIndex < 0 || pageIndex >= pages.length) throw new ApiError("bad_request", `Page ${pageIndex + 1} is not in this PDF`);
  const page = pages[pageIndex];
  let rect = [0, 0, 0, 0];
  if (opts.visible) {
    // a small box at the bottom left of the page: who signed, when, why
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const lines = [`Digitally signed by ${signer.name}`, `Date: ${now.toISOString().replace("T", " ").slice(0, 19)} UTC`]
      .concat(opts.reason ? [`Reason: ${opts.reason}`] : []);
    const ascii = (s: string) => s.replace(/[^\x20-\x7e]/g, "?");
    const w = Math.max(...lines.map((l) => font.widthOfTextAtSize(ascii(l), 8))) + 12, h = lines.length * 11 + 8;
    page.drawRectangle({ x: 36, y: 36, width: w, height: h, borderColor: rgb(0.15, 0.39, 0.92), borderWidth: 0.8, color: rgb(0.95, 0.97, 1) });
    lines.forEach((l, i) => page.drawText(ascii(l), { x: 42, y: 36 + h - 14 - i * 11, size: 8, font, color: rgb(0.1, 0.1, 0.2) }));
    rect = [36, 36, 36 + w, 36 + h];
  }
  const byteRange = PDFArray.withContext(ctx);
  byteRange.push(PDFNumber.of(0));
  byteRange.push(PDFName.of(DEFAULT_BYTE_RANGE_PLACEHOLDER));
  byteRange.push(PDFName.of(DEFAULT_BYTE_RANGE_PLACEHOLDER));
  byteRange.push(PDFName.of(DEFAULT_BYTE_RANGE_PLACEHOLDER));
  const sigDict = ctx.obj({
    Type: "Sig", Filter: "Adobe.PPKLite", SubFilter: SUBFILTER_ADOBE_PKCS7_DETACHED, ByteRange: byteRange,
    Contents: PDFHexString.of("0".repeat(SIGNATURE_LENGTH)),
    Reason: PDFString.of(opts.reason || "Signed with WorkSuite Office"), M: PDFString.fromDate(now),
    ContactInfo: PDFString.of(opts.contact || signer.email || ""), Name: PDFString.of(signer.name), Location: PDFString.of(opts.location || ""),
  });
  const sigRef = ctx.register(sigDict);
  const existing = doc.getForm().getFields().filter((f) => f.constructor.name === "PDFSignature").length;
  const widget = ctx.obj({
    Type: "Annot", Subtype: "Widget", FT: "Sig", Rect: rect, V: sigRef, T: PDFString.of(`Signature${existing + 1}`), F: 4, P: page.ref,
  });
  const widgetRef = ctx.register(widget);
  const annots = page.node.lookup(PDFName.of("Annots"));
  if (annots instanceof PDFArray) annots.push(widgetRef);
  else page.node.set(PDFName.of("Annots"), ctx.obj([widgetRef]));
  const acro = doc.getForm().acroForm;
  acro.addField(widgetRef);
  acro.dict.set(PDFName.of("SigFlags"), PDFNumber.of(3));
  const unsigned = Buffer.from(await doc.save({ useObjectStreams: false }));
  const pdf = await new SignPdf().sign(unsigned, new P12Signer(p12, { passphrase }), now);
  return { pdf, signer };
}

export interface FoundSignature { field: number; signer: string; signedAt?: string; reason?: string; intact: boolean; coversWholeFile: boolean }

/**
 * The signatures of a PDF: for each, whether the signed bytes still match the signature (intact) and whether it
 * covers the file to its end (later saves add bytes after it). Trust in the signer's certificate is not judged.
 */
export function checkSignatures(pdf: Buffer): FoundSignature[] {
  const text = pdf.toString("latin1");
  const out: FoundSignature[] = [];
  const re = /\/ByteRange\s*\[\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s*\]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const [a, b, c, d] = m.slice(1).map(Number);
    if (c + d > pdf.length || b > c) continue;
    const hex = text.slice(a + b + 1, c - 1).replace(/0+$/, "");
    const signed = Buffer.concat([pdf.subarray(a, a + b), pdf.subarray(c, c + d)]);
    let intact = false, signer = "Unknown", signedAt: string | undefined;
    try {
      const der = Buffer.from(hex.length % 2 ? hex + "0" : hex, "hex");
      const msg = forge.pkcs7.messageFromAsn1(forge.asn1.fromDer(forge.util.createBuffer(der.toString("binary")))) as forge.pkcs7.PkcsSignedData & {
        rawCapture: { authenticatedAttributes?: forge.asn1.Asn1[]; signature: string; digestAlgorithm: string };
      };
      const cert = msg.certificates[0];
      signer = nameOf(cert.subject.attributes);
      const attrs = msg.rawCapture.authenticatedAttributes || [];
      let digest: string | undefined;
      for (const attr of attrs) {
        const seq = attr.value as forge.asn1.Asn1[];
        const oid = forge.asn1.derToOid(seq[0].value as string);
        const value = ((seq[1].value as forge.asn1.Asn1[])[0]).value as string;
        if (oid === forge.pki.oids.messageDigest) digest = value;
        if (oid === forge.pki.oids.signingTime) signedAt = forge.asn1.utcTimeToDate(value).toISOString();
      }
      const hash = forge.pki.oids.sha512 === forge.asn1.derToOid(msg.rawCapture.digestAlgorithm) ? "sha512"
        : forge.pki.oids.sha384 === forge.asn1.derToOid(msg.rawCapture.digestAlgorithm) ? "sha384" : "sha256";
      const contentOk = digest === createHash(hash).update(signed).digest().toString("binary");
      // the signature is over the DER SET of the signed attributes
      const set = forge.asn1.create(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.SET, true, attrs);
      const md = (forge.md as unknown as Record<string, { create(): forge.md.MessageDigest }>)[hash].create();
      md.update(forge.asn1.toDer(set).getBytes());
      const sigOk = (cert.publicKey as forge.pki.rsa.PublicKey).verify(md.digest().getBytes(), msg.rawCapture.signature);
      intact = contentOk && sigOk;
    } catch { intact = false; }
    // the dictionary goes on past the signature itself (/Contents, SIGNATURE_LENGTH hex digits)
    const tail = text.slice(m.index, m.index + SIGNATURE_LENGTH * 2 + 4000);
    const reason = /\/Reason\s*\(([^)]*)\)/.exec(tail)?.[1];
    out.push({ field: out.length + 1, signer, ...(signedAt ? { signedAt } : {}), ...(reason ? { reason } : {}), intact, coversWholeFile: c + d === pdf.length || c + d === pdf.length - 1 });
  }
  return out;
}
