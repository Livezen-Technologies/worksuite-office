// @worksuite/sinhala-core: legacy Sinhala font text (FM Abhaya, DL Manel, Kaputa, Thara, Kandy and the fonts sharing their layouts) to Unicode and back,
// Singlish (romanised) to Sinhala transliteration with ranked candidates and a Sinhala input method,
// detection and validation. No DOM or Node APIs: the same engine runs in the ONLYOFFICE plugin, in an
// editor command, in WorkSuite Desktop and behind the WorkSuite server.
export { sha256Hex, canonicalJson } from "./sha256";
export { Profile, builtinProfiles, getProfile, legacyFonts, profileForFont, profileHash, verifyProfile } from "./profiles";
export { ConvertResult, Direction, Unmapped, convert, toLegacy, toUnicode } from "./convert";
export { Detection, Segment, SegmentKind, detect } from "./detect";
export { Issue, IssueCode, normalize, validate } from "./normalize";
export { Option, Piece, Segment as TranslitSegment, Variant, VowelKey, render, segment, transliterate, variants } from "./translit";
export { Candidate, CandidateOptions, LearnedData, Learner, Lexicon, candidates } from "./suggest";
export { ImeAction, ImeOptions, SinhalaIme } from "./ime";
export { COLLOQUIAL, EnglishWords, SmartDecision, SmartReason, smartDecision } from "./smart";
export { isSinhala, isConsonant, ZWJ, ZWNJ } from "./script";


export { EnglishLexicon, EnglishSources, Correction, PROPER, applyCase, distance } from "./english";
export { Bigrams, Personal, PersonalData } from "./bigrams";
export { InputMode, LangDecision, Rule, TokenLang, DetectContext, MARKERS, THRESHOLD, CONTEXT_WINDOW, CONTEXT_WEIGHTS, CONTEXT_MIN, contextLean, detectToken, englishScore, phonotactic, singlishScore } from "./lang";
export { DEFAULT_SETTINGS, ItemKind, SmartData, SmartEngine, SmartItem, SmartQuery, SmartResult, SmartSettings, words } from "./engine";
export { AiScheduler, KEY, SmartTyping, TypingAction, TypingOptions } from "./typing";
export const VERSION = "1.2.0";
