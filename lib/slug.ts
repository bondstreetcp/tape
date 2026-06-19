/** URL-safe slug for a GICS industry name, e.g. "Health Care Equipment" -> "health-care-equipment". */
export function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function findIndustryBySlug(
  industries: string[],
  slug: string,
): string | null {
  return industries.find((i) => slugify(i) === slug) ?? null;
}
