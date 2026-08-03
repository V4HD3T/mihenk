/**
 * similarity.service.js
 *
 * Heuristic code-similarity ("plagiarism screening") engine based on the
 * Winnowing algorithm (Schleimer, Wilkerson, Aiken - "Winnowing: Local
 * Algorithms for Document Fingerprinting", the algorithm behind MOSS).
 *
 * Pipeline: source -> tokens (comments stripped, string literals and
 * identifiers normalized, language keywords preserved) -> k-grams ->
 * rolling hashes -> winnowed fingerprint set. Two submissions are compared
 * by the overlap of their fingerprint sets, which is robust to variable
 * renaming, reformatting, and comment changes while still requiring a
 * non-trivial run of matching structure to register a match.
 *
 * IMPORTANT: this is a *screening* tool, not a verdict. Short, simple
 * exercises legitimately have only one or two reasonable solutions, so a
 * high raw score does not by itself prove copying - see computeClassReport()
 * for how a per-problem baseline is used to separate "everyone converges on
 * this" from "these two are unusually alike compared to their classmates".
 * Final judgment is always left to the teacher.
 */

const K_GRAM_SIZE = 5; // tokens per gram
const WINDOW_SIZE = 4; // winnowing window (guarantees detection of matches >= K_GRAM_SIZE + WINDOW_SIZE - 1 tokens)

const PYTHON_KEYWORDS = new Set(
  'False None True and as assert async await break class continue def del elif else except finally for from global if import in is lambda nonlocal not or pass raise return try while with yield print len range input'.split(' ')
);

const CPP_KEYWORDS = new Set(
  ('alignas alignof and asm auto bitand bitor bool break case catch char char8_t char16_t char32_t class compl concept ' +
    'const consteval constexpr constinit const_cast continue decltype default delete do double dynamic_cast else enum ' +
    'explicit export extern false float for friend goto if inline int long mutable namespace new noexcept not nullptr ' +
    'operator or private protected public register reinterpret_cast requires return short signed sizeof static ' +
    'static_assert static_cast struct switch template this thread_local throw true try typedef typeid typename union ' +
    'unsigned using virtual void volatile wchar_t while xor include define ifndef endif pragma std cout cin endl').split(' ')
);

const JAVA_KEYWORDS = new Set(
  ('abstract assert boolean break byte case catch char class const continue default do double else enum extends final ' +
    'finally float for goto if implements import instanceof int interface long native new package private protected ' +
    'public return short static strictfp super switch synchronized this throw throws transient try void volatile ' +
    'while true false null var record yield System out println print').split(' ')
);

const JAVASCRIPT_KEYWORDS = new Set(
  ('break case catch class const continue debugger default delete do else export extends finally for function if ' +
    'import in instanceof new return super switch this throw try typeof var void while with yield let static async ' +
    'await true false null undefined console log').split(' ')
);

function keywordSetFor(language) {
  if (language === 'python') return PYTHON_KEYWORDS;
  if (language === 'java') return JAVA_KEYWORDS;
  if (language === 'javascript') return JAVASCRIPT_KEYWORDS;
  return CPP_KEYWORDS; // 'c' shares the C++ set - a strict superset for this purpose, so nothing is missed
}

// Two tokenizer patterns: Python's "#" comments vs C-style "//" and "/* */".
// String/char literals and comments are recognized here so they can be
// normalized/dropped instead of leaking their raw content into the token stream.
const PYTHON_TOKEN_REGEX = /#[^\n]*|"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|==|!=|<=|>=|\*\*|\/\/|[A-Za-z_][A-Za-z0-9_]*|\d+\.?\d*|[^\s]/g;
const C_STYLE_TOKEN_REGEX = /\/\/[^\n]*|\/\*[\s\S]*?\*\/|"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|==|!=|<=|>=|&&|\|\||->|::|\+\+|--|\+=|-=|\*=|\/=|%=|<<|>>|[A-Za-z_][A-Za-z0-9_]*|\d+\.?\d*|[^\s]/g;

/**
 * Turns source code into a normalized token stream, each token carrying its
 * character span in the ORIGINAL source (needed later to highlight matches).
 * - Comments are dropped entirely (no token emitted).
 * - String/char literals collapse to a single generic "STR" token.
 * - Numbers collapse to "NUM".
 * - Identifiers collapse to "ID" *unless* they are a language keyword, in
 *   which case the keyword itself is kept (this is what makes the match
 *   resistant to renaming variables/functions but still sensitive to
 *   control-flow and structure).
 * - Operators/punctuation are kept as-is.
 */
function tokenize(code, language) {
  const regex = language === 'python' ? PYTHON_TOKEN_REGEX : C_STYLE_TOKEN_REGEX;
  const keywords = keywordSetFor(language);
  const tokens = [];

  for (const match of code.matchAll(regex)) {
    const raw = match[0];
    const start = match.index;
    const end = start + raw.length;
    const first = raw[0];

    if (first === '#' || raw.startsWith('//') || raw.startsWith('/*')) continue; // comment: drop
    if (first === '"' || first === "'") {
      tokens.push({ normalized: 'STR', start, end });
      continue;
    }
    if (/^[0-9]/.test(raw)) {
      tokens.push({ normalized: 'NUM', start, end });
      continue;
    }
    if (/^[A-Za-z_]/.test(raw)) {
      tokens.push({ normalized: keywords.has(raw) ? raw : 'ID', start, end });
      continue;
    }
    // operators / punctuation kept verbatim
    tokens.push({ normalized: raw, start, end });
  }
  return tokens;
}

/** 32-bit string hash (same recurrence as Java's String.hashCode()). */
function hashString(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = (Math.imul(h, 31) + str.charCodeAt(i)) | 0;
  }
  return h;
}

/**
 * Builds the winnowed fingerprint set for a token stream.
 * Returns an array of { hash, start, end } - the selected k-grams, each
 * still carrying its span in the original source for later highlighting.
 */
function winnow(tokens, k = K_GRAM_SIZE, w = WINDOW_SIZE) {
  if (tokens.length < k) return [];

  const grams = [];
  for (let i = 0; i <= tokens.length - k; i++) {
    const slice = tokens.slice(i, i + k);
    const hash = hashString(slice.map((t) => t.normalized).join(' '));
    grams.push({ hash, start: slice[0].start, end: slice[slice.length - 1].end, index: i });
  }

  if (grams.length <= w) {
    // document too short for a full window: every gram is its own fingerprint
    return grams;
  }

  const fingerprints = [];
  let prevSelected = -1;
  for (let i = 0; i <= grams.length - w; i++) {
    let min = grams[i];
    for (let j = i + 1; j < i + w; j++) {
      if (grams[j].hash <= min.hash) min = grams[j]; // <= keeps the rightmost minimum
    }
    if (min.index !== prevSelected) {
      fingerprints.push(min);
      prevSelected = min.index;
    }
  }
  return fingerprints;
}

/** Tokenizes + fingerprints a submission in one step. */
function computeFingerprint(code, language) {
  const tokens = tokenize(code, language);
  const fingerprints = winnow(tokens);
  return { tokenCount: tokens.length, fingerprints };
}

/**
 * Compares two fingerprint sets.
 * percentA/percentB = what fraction of each document's fingerprints are
 * also present in the other (MOSS reports both directions since a short
 * submission fully contained in a longer one is still a strong signal).
 */
function compareFingerprints(fpA, fpB) {
  const hashesA = new Set(fpA.map((f) => f.hash));
  const hashesB = new Set(fpB.map((f) => f.hash));
  if (hashesA.size === 0 || hashesB.size === 0) {
    return { percentA: 0, percentB: 0, similarity: 0, sharedCount: 0, shared: new Set() };
  }
  const shared = new Set([...hashesA].filter((h) => hashesB.has(h)));
  const percentA = (shared.size / hashesA.size) * 100;
  const percentB = (shared.size / hashesB.size) * 100;
  return { percentA, percentB, similarity: Math.max(percentA, percentB), sharedCount: shared.size, shared };
}

/** Maps a shared-hash set back to merged, highlightable character ranges in one document. */
function getMatchedSpans(fingerprints, sharedHashSet) {
  const spans = fingerprints
    .filter((f) => sharedHashSet.has(f.hash))
    .map((f) => [f.start, f.end])
    .sort((a, b) => a[0] - b[0]);

  const merged = [];
  for (const [s, e] of spans) {
    const last = merged[merged.length - 1];
    if (last && s <= last[1] + 1) {
      last[1] = Math.max(last[1], e);
    } else {
      merged.push([s, e]);
    }
  }
  return merged;
}

function median(values) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Computes all pairwise similarities within a set of submissions (assumed
 * to already be filtered to one language and one submission per student).
 * Flags a pair as "notable" only if it clears BOTH an absolute floor and a
 * margin above the group's own median - this is what keeps a trivial
 * exercise (where every correct solution looks alike) from flagging the
 * whole class.
 */
function computeClassReport(submissions) {
  const withPrints = submissions.map((s) => ({
    ...s,
    ...computeFingerprint(s.code, s.language),
  }));

  const pairs = [];
  for (let i = 0; i < withPrints.length; i++) {
    for (let j = i + 1; j < withPrints.length; j++) {
      const a = withPrints[i];
      const b = withPrints[j];
      const cmp = compareFingerprints(a.fingerprints, b.fingerprints);
      pairs.push({
        submissionIdA: a.submissionId,
        submissionIdB: b.submissionId,
        userIdA: a.userId,
        userIdB: b.userId,
        userNameA: a.userName,
        userNameB: b.userName,
        similarity: Math.round(cmp.similarity * 10) / 10,
        percentA: Math.round(cmp.percentA * 10) / 10,
        percentB: Math.round(cmp.percentB * 10) / 10,
      });
    }
  }

  const baseline = median(pairs.map((p) => p.similarity));
  const ABSOLUTE_FLOOR = 60;
  const MARGIN_OVER_BASELINE = 20;

  for (const p of pairs) {
    p.isNotable = p.similarity >= ABSOLUTE_FLOOR && p.similarity >= baseline + MARGIN_OVER_BASELINE;
  }

  pairs.sort((a, b) => b.similarity - a.similarity);
  return { baseline: Math.round(baseline * 10) / 10, pairs };
}

module.exports = {
  tokenize,
  computeFingerprint,
  compareFingerprints,
  getMatchedSpans,
  computeClassReport,
  K_GRAM_SIZE,
  WINDOW_SIZE,
};
