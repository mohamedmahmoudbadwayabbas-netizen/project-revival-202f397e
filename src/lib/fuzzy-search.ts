/**
 * Arabic Text Normalization & Fuzzy Search Engine
 * Handles typo tolerance, diacritics stripping, letter normalization, and string distance algorithms.
 */

export function normalizeArabic(text: string): string {
  if (!text) return "";
  return (
    text
      // Strip Arabic diacritics (tashkeel)
      .replace(/[\u064B-\u0652]/g, "")
      // Normalize Alef forms: أ, إ, آ, ٱ -> ا
      .replace(/[أإآٱ]/g, "ا")
      // Normalize Teh Marbuta: ة -> ه
      .replace(/ة/g, "ه")
      // Normalize Alef Maksura: ى -> ي
      .replace(/ى/g, "ي")
      // Normalize Waw with Hamza / Yeh with Hamza
      .replace(/ؤ/g, "و")
      .replace(/ئ/g, "ي")
      // Trim and collapse spaces
      .toLowerCase()
      .trim()
  );
}

// Keys and values are written in normalized form (see normalizeArabic).
const SEARCH_SYNONYMS: Record<string, string[]> = {
  لبن: ["حليب"],
  حليب: ["لبن"],
  جهينه: ["جهينه", "جيهنه"],
  جيهنه: ["جهينه"],
  بطاطا: ["بطاطس"],
  بندوره: ["طماطم"],
  رز: ["ارز"],
  ارز: ["رز"],
  عيش: ["خبز"],
  خبز: ["عيش"],
  فراخ: ["دجاج"],
  دجاج: ["فراخ"],
  لحمه: ["لحم"],
  جبنه: ["جبن"],
};

/**
 * Calculates Levenshtein Distance between two strings for typo tolerance.
 */
export function levenshteinDistance(a: string, b: string): number {
  const matrix: number[][] = [];

  for (let i = 0; i <= b.length; i++) matrix[i] = [i];
  for (let j = 0; j <= a.length; j++) matrix[0][j] = j;

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1, // substitution
          matrix[i][j - 1] + 1, // insertion
          matrix[i - 1][j] + 1, // deletion
        );
      }
    }
  }

  return matrix[b.length][a.length];
}

/** Article/preposition prefixes stripped from target words ("بالحليب" → "حليب"). */
const WORD_PREFIXES = ["وبال", "بال", "وال", "فال", "كال", "لل", "ال"];

function stripPrefix(word: string): string {
  for (const prefix of WORD_PREFIXES) {
    if (word.startsWith(prefix) && word.length - prefix.length >= 2) return word.slice(prefix.length);
  }
  return word;
}

/** Edits allowed for a typo, by query word length: short words must match exactly. */
function allowedTypos(length: number): number {
  if (length <= 3) return 0;
  if (length <= 5) return 1;
  return 2;
}

function tokenize(text: string): string[] {
  return normalizeArabic(text)
    .split(/[\s\-_/،,.()]+/)
    .filter(Boolean);
}

/** Best score of one query word against the target words (0 = no match). */
function scoreWord(queryWord: string, targetWords: string[], allowTypos: boolean): number {
  const synonyms = SEARCH_SYNONYMS[queryWord] ?? [];
  let best = 0;
  for (const raw of targetWords) {
    for (const word of new Set([raw, stripPrefix(raw)])) {
      if (word === queryWord) return 1;
      if (word.startsWith(queryWord) && queryWord.length >= 2) best = Math.max(best, 0.9);
      if (synonyms.some((syn) => word === syn || word.startsWith(syn))) best = Math.max(best, 0.88);
      if (!allowTypos) continue;
      const maxEdits = allowedTypos(queryWord.length);
      if (maxEdits === 0) continue;
      // Compare with the whole word and with its beginning (customer may still be typing).
      const candidates = [word, word.slice(0, queryWord.length)];
      for (const candidate of candidates) {
        const dist = levenshteinDistance(queryWord, candidate);
        if (dist <= maxEdits) best = Math.max(best, 0.75 - 0.1 * dist);
      }
    }
  }
  return best;
}

/**
 * Checks if a query fuzzy-matches a target text.
 * Returns a score between 0 (no match) and 1 (exact/perfect match).
 */
export function getFuzzyMatchScore(
  query: string,
  targetText: string,
  options: { allowTypos?: boolean } = {},
): number {
  const allowTypos = options.allowTypos ?? true;
  const queryWords = tokenize(query).map(stripPrefix);
  const targetWords = tokenize(targetText);
  if (!queryWords.length || !targetWords.length) return 0;

  if (normalizeArabic(targetText) === normalizeArabic(query)) return 1;

  // Every query word has to match something; the score is their average.
  let total = 0;
  for (const word of queryWords) {
    const score = scoreWord(word, targetWords, allowTypos);
    if (score === 0) return 0;
    total += score;
  }
  return total / queryWords.length;
}

export function searchProductsFuzzy<
  T extends { name: string; name_ar?: string | null; description?: string | null },
>(products: T[], query: string, minThreshold: number = 0.45): T[] {
  if (!query.trim()) return products;

  const scored = products.map((product, index) => {
    const nameScore = Math.max(
      getFuzzyMatchScore(query, product.name),
      product.name_ar ? getFuzzyMatchScore(query, product.name_ar) : 0,
    );
    // Descriptions only count for real words (no typo guessing), and weigh less than the name.
    const descScore = product.description
      ? getFuzzyMatchScore(query, product.description, { allowTypos: false }) * 0.6
      : 0;
    return { product, index, score: Math.max(nameScore, descScore) };
  });

  return scored
    .filter((item) => item.score >= minThreshold)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((item) => item.product);
}
