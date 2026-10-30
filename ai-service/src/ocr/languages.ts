// Text recognition (OCR) languages the PDF editor can add: Tesseract's tessdata_fast 4.1.0 models (Apache-2.0),
// pinned by size and sha256, downloaded on request into <data>/ocr/lang/ and handed to the editor's tesseract.js.
// English, Sinhala and Tamil ship with the app (build/v10/ocr.sh) and are not listed here.
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { ApiError } from "../errors";
import { download, sha256File, requireDisk } from "../download";
import type { Fetcher } from "../catalog";
import type { JobControl } from "../jobs";

export const OCR_SOURCE = "https://raw.githubusercontent.com/tesseract-ocr/tessdata_fast/4.1.0/";

export interface OcrLanguage { code: string; name: string; size: number; sha256: string }

export const OCR_LANGUAGES: OcrLanguage[] = [
  { code: "ara", name: "Arabic", size: 1432056, sha256: "e3206d3dc87fd50c24a0fb9f01838615911d25168f4e64415244b67d2bb3e729" },
  { code: "ben", name: "Bengali", size: 855841, sha256: "31163084c279aaebd376216f0c3d5c17ad4b5fee8db49dae79c20000b5de5964" },
  { code: "chi_sim", name: "Chinese (Simplified)", size: 2469156, sha256: "a5fcb6f0db1e1d6d8522f39db4e848f05984669172e584e8d76b6b3141e1f730" },
  { code: "chi_tra", name: "Chinese (Traditional)", size: 2366642, sha256: "529c5b5797d64b126065cd55f2bb4c7fd7b15790798091b1ff259941a829330b" },
  { code: "nld", name: "Dutch", size: 6050296, sha256: "ced0e5e046a84c908a6aa7accbef9a232c4a5d9a8276691b81c6ee64d02963f6" },
  { code: "fra", name: "French", size: 1130365, sha256: "ced037562e8c80c13122dece28dd477d399af80911a28791a66a63ac1e3445ca" },
  { code: "deu", name: "German", size: 1525436, sha256: "19d219bbb6672c869d20a9636c6816a81eb9a71796cb93ebe0cb1530e2cdb22d" },
  { code: "guj", name: "Gujarati", size: 1418394, sha256: "fa69658614b4946a9afae8853d67e0689838803dfa3d12c2e35ec53ee6f8df34" },
  { code: "hin", name: "Hindi", size: 1122751, sha256: "4c73ffc59d497c186b19d1e90f5d721d678ea6b2e277b719bee4e2af12271825" },
  { code: "ind", name: "Indonesian", size: 1122661, sha256: "69786901da87ab8766c1ea7fbb10b28f2110c14da3f6c8f2735df131fba95d88" },
  { code: "ita", name: "Italian", size: 2701314, sha256: "b8f89e1e785118dac4d51ae042c029a64edb5c3ee42ef73027a6d412748d8827" },
  { code: "jpn", name: "Japanese", size: 2471260, sha256: "1f5de9236d2e85f5fdf4b3c500f2d4926f8d9449f28f5394472d9e8d83b91b4d" },
  { code: "kan", name: "Kannada", size: 3608331, sha256: "bd31e6b6ae93271e3bcf5383d306d8eefbb91542937cd6d735a5930c970e61d8" },
  { code: "kor", name: "Korean", size: 1677415, sha256: "6b85e11d9bbf07863b97b3523b1b112844c43e713df8b66418a081fd1060b3b2" },
  { code: "msa", name: "Malay", size: 1747801, sha256: "e41a3e5febfec50c90371eb1cbb17a48b10cad387900e3420b1f134c1b766cba" },
  { code: "mal", name: "Malayalam", size: 5275996, sha256: "bd05cbf1b197e7810d2903419aedb06f9ef77bfedf50b358673c1d18d707cdb4" },
  { code: "mar", name: "Marathi", size: 2118233, sha256: "0ba3f2d116972e72fe9e176bc84c38e81dfb6670f4ed1f7f6c8e16a27da7cb61" },
  { code: "nep", name: "Nepali", size: 1002911, sha256: "280ba9450b4f21afbf5985e0de87857b75a972577c50ef0603c141ddde4f1cb8" },
  { code: "por", name: "Portuguese", size: 1982756, sha256: "c4932b937207a9514b7514d518b931a99938c02a28a5a5a553f8599ed58b7deb" },
  { code: "pan", name: "Punjabi", size: 497721, sha256: "1ec0907fc3534065ea9ae190c6bb7ec9e5c74fd9d2fa996aaec7407f11ad8131" },
  { code: "rus", name: "Russian", size: 3861738, sha256: "e16e5e036cce1d9ec2b00063cf8b54472625b9e14d893a169e2b0dedeb4df225" },
  { code: "spa", name: "Spanish", size: 2294433, sha256: "6f2e04d02774a18f01bed44b1111f2cd7f3ba7ac9dc4373cd3f898a40ea6b464" },
  { code: "tel", name: "Telugu", size: 2769654, sha256: "d10691fddd5b67802e1c12800ebb321d3b8bcd8d24a2ac3ff206f93188c04ab5" },
  { code: "tha", name: "Thai", size: 1072600, sha256: "294227cc2d1292b0acb28d61d4115c88252b96d466ca90b417cf4cf0c67bf07c" },
  { code: "tur", name: "Turkish", size: 4550554, sha256: "7393381111e1152420fc4092cb44eef4237580d21b92bf30d7d221aad192c6b7" },
  { code: "urd", name: "Urdu", size: 1398718, sha256: "62e8250ce2a994106e313a82e26a516a39e2cf159d0ce3c5b5008387fd0d555f" },
  { code: "vie", name: "Vietnamese", size: 531275, sha256: "79df64caf7bcfb2a27df5042ecb6121e196eada34da774956995747636d5bfa1" },
];

export class OcrLanguages {
  constructor(private dir: string, private fetcher?: Fetcher) {}

  private file(code: string): string { return join(this.dir, `${code}.traineddata`); }

  private find(code: string): OcrLanguage {
    const l = OCR_LANGUAGES.find((x) => x.code === code);
    if (!l) throw new ApiError("not_found", "No such OCR language", { code });
    return l;
  }

  installed(code: string): boolean {
    const l = this.find(code);
    return existsSync(this.file(code)) && statSync(this.file(code)).size === l.size;
  }

  list(): (OcrLanguage & { installed: boolean })[] {
    return OCR_LANGUAGES.map((l) => ({ ...l, installed: this.installed(l.code) }));
  }

  /** Downloads and checks a language model; a job. */
  install(code: string): (job: JobControl) => Promise<{ code: string; installed: true }> {
    const l = this.find(code);
    return async (job) => {
      if (this.installed(code)) return { code, installed: true };
      mkdirSync(this.dir, { recursive: true, mode: 0o700 });
      requireDisk(this.dir, l.size * 2);
      const part = this.file(code) + ".download";
      await download({ url: OCR_SOURCE + `${code}.traineddata`, dest: part, size: l.size, signal: job.signal, fetcher: this.fetcher,
        onBytes: (done, total) => job.progress(total ? done / total : 0, "downloading") });
      const sha = await sha256File(part, job.signal);
      if (sha !== l.sha256) {
        rmSync(part, { force: true });
        throw new ApiError("integrity_failed", `The ${l.name} model does not match its checksum`, { code, expected: l.sha256, got: sha });
      }
      // rename after the check, so a half-written model is never used
      renameSync(part, this.file(code));
      return { code, installed: true };
    };
  }

  remove(code: string): { code: string; removed: boolean } {
    this.find(code);
    const had = existsSync(this.file(code));
    rmSync(this.file(code), { force: true });
    return { code, removed: had };
  }

  data(code: string): Buffer {
    if (!this.installed(code)) throw new ApiError("not_found", "This OCR language is not installed", { code, reason: "not_installed" });
    return readFileSync(this.file(code));
  }
}
