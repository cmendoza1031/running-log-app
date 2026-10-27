/**
 * Normalizes free-text athlete inputs (e.g. goal "Other") before storage / LLM context.
 * Not a substitute for prompt design, but removes control chars, length bombs, and obvious noise.
 */
export function sanitizeAthleteFreeText(input: string, maxLen = 200): string {
  let s = input.normalize("NFKC");
  s = s.replace(/[\u0000-\u001F\u007F-\u009F]/g, "");
  s = s.replace(/[\u200B-\u200D\uFEFF\u2028\u2029]/g, "");
  s = s.replace(/```[\s\S]*?```/g, " ");
  s = s.replace(/<\/?[a-z][^>]*>/gi, " ");
  s = s.replace(/\s+/g, " ").trim();
  if (s.length > maxLen) s = s.slice(0, maxLen).trim();
  return s;
}
