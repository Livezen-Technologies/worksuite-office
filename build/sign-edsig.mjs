#!/usr/bin/env node
/**
 * Signs an update archive for Sparkle (macOS) or WinSparkle (Windows) and writes <file>.edsig: the
 * base64 Ed25519 signature over the whole file, the appcast's sparkle:edSignature. Both updaters check
 * it against the public key built into the app (SUPublicEDKey / win_sparkle_set_eddsa_public_key), so
 * this script also checks the signature against SPARKLE_PUBLIC_ED_KEY before it writes anything.
 *
 *   SPARKLE_ED_PRIVATE_KEY=<base64> SPARKLE_PUBLIC_ED_KEY=<base64> node build/sign-edsig.mjs <file>...
 *
 * The private key is what Sparkle 2's `generate_keys -x` exports (and `winsparkle-tool` reads): the
 * base64 32-byte Ed25519 seed. A 64-byte seed+public key is taken as well. Sign the file last: an
 * Authenticode signature, codesign or notarisation staple after this changes the bytes and breaks it.
 */
import { createPrivateKey, createPublicKey, sign, verify } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

const die = (msg) => { console.error(`::error::sign-edsig: ${msg}`); process.exit(1); };
const files = process.argv.slice(2);
if (!files.length) die('give the files to sign');
const priv = Buffer.from((process.env.SPARKLE_ED_PRIVATE_KEY || '').trim(), 'base64');
const pubB64 = (process.env.SPARKLE_PUBLIC_ED_KEY || '').trim();
if (priv.length !== 32 && priv.length !== 64) {
  die(`SPARKLE_ED_PRIVATE_KEY is ${priv.length} bytes; expected the 32-byte seed that Sparkle 2's generate_keys -x exports`);
}
const pub = Buffer.from(pubB64, 'base64');
if (pub.length !== 32) die('SPARKLE_PUBLIC_ED_KEY must be the base64 32-byte public key (SUPublicEDKey)');

const pkcs8 = Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), priv.subarray(0, 32)]);
const key = createPrivateKey({ key: pkcs8, format: 'der', type: 'pkcs8' });
const publicKey = createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x: pub.toString('base64url') }, format: 'jwk' });
if (createPublicKey(key).export({ format: 'jwk' }).x !== pub.toString('base64url')) {
  die('SPARKLE_ED_PRIVATE_KEY is not the private half of SPARKLE_PUBLIC_ED_KEY: the app would refuse the update');
}
for (const file of files) {
  const bytes = readFileSync(file);
  const sig = sign(null, bytes, key);
  if (!verify(null, bytes, publicKey, sig)) die(`${file}: the signature does not verify`);
  writeFileSync(`${file}.edsig`, `${sig.toString('base64')}\n`);
  console.log(`${file}.edsig: Ed25519 over ${bytes.length} bytes, checked against SPARKLE_PUBLIC_ED_KEY`);
}
