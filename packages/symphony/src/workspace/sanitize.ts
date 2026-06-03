const SAFE_IDENTIFIER_CHARACTER = /[A-Za-z0-9._-]/;

/**
 * Convert an issue identifier into a single filesystem path segment.
 *
 * Non-ASCII and path separator characters are deliberately replaced rather
 * than removed so distinct invalid inputs do not collapse as easily.
 */
export const sanitizeIdentifier = (identifier: string): string => {
  let sanitized = "";

  for (const character of identifier) {
    sanitized += SAFE_IDENTIFIER_CHARACTER.test(character) ? character : "_";
  }

  return sanitized === "" ? "_" : sanitized;
};
