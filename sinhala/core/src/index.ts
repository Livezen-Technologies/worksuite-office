// @worksuite/sinhala-core: legacy Sinhala font text (FM Abhaya, DL Manel, Kaputa) to Unicode and back,
// Singlish (romanised) to Sinhala transliteration with ranked candidates and a Sinhala input method,
// detection and validation. No DOM or Node APIs: the same engine runs in the ONLYOFFICE plugin, in an
// editor command, in WorkSuite Desktop and behind the WorkSuite server.
export { sha256Hex, canonicalJson } from "./sha256";
export { Profile, builtinProfiles, getProfile, profileForFont, profileHash, verifyProfile } from "./profiles";
export { ConvertResult, Direction, Unmapped, convert, toLegacy, toUnicode } from "./convert";
export { Detection, Segment, SegmentKind, detect } from "./detect";
export { Issue, IssueCode, normalize, validate } from "./normalize";
export { Option, Piece, Segment as TranslitSegment, Variant, VowelKey, render, segment, transliterate, variants } from "./translit";
export { Candidate, CandidateOptions, LearnedData, Learner, Lexicon, candidates } from "./suggest";
export { ImeAction, ImeOptions, SinhalaIme } from "./ime";
export { isSinhala, isConsonant, ZWJ, ZWNJ } from "./script";

export const VERSION = "1.1.0";
