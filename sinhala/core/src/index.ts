// @worksuite/sinhala-core: legacy Sinhala font text (FM Abhaya, DL Manel, Kaputa) to Unicode and back,
// detection and validation. No DOM or Node APIs: the same engine runs in the ONLYOFFICE plugin, in an
// editor command, in WorkSuite Desktop and behind the WorkSuite server.
export { sha256Hex, canonicalJson } from "./sha256";
export { Profile, builtinProfiles, getProfile, profileForFont, profileHash, verifyProfile } from "./profiles";
export { ConvertResult, Direction, Unmapped, convert, toLegacy, toUnicode } from "./convert";
export { Detection, Segment, SegmentKind, detect } from "./detect";
export { Issue, IssueCode, normalize, validate } from "./normalize";
export { isSinhala, isConsonant, ZWJ, ZWNJ } from "./script";

export const VERSION = "1.0.0";
