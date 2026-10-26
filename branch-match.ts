/**
 * Pure branch-name matching used by `/worktree:existing <query>`.
 *
 * Policy (first hit wins):
 *   1. exact local branch name (case-sensitive);
 *   2. case-insensitive substring of the branch name;
 *   3. typo-tolerant match of the query against the branch's name
 *      components (split on "/", "-", "_", "."), using optimal string
 *      alignment distance (adjacent transpositions count as one edit).
 *
 * Any step with more than one equally-good candidate is reported as
 * ambiguous instead of choosing one. No match returns null so the caller
 * keeps its existing "does not exist" behaviour.
 */

export type BranchMatch =
  | { kind: "match"; branch: string }
  | { kind: "ambiguous"; candidates: string[] };

/** Optimal string alignment distance (Levenshtein + adjacent transposition). */
export function editDistance(a: string, b: string): number {
  const n = a.length;
  const m = b.length;
  const d: number[][] = [];
  for (let i = 0; i <= n; i++) {
    d.push(new Array<number>(m + 1).fill(0));
    d[i][0] = i;
  }
  for (let j = 0; j <= m; j++) d[0][j] = j;
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(
        d[i - 1][j] + 1,
        d[i][j - 1] + 1,
        d[i - 1][j - 1] + cost,
      );
      if (
        i > 1 &&
        j > 1 &&
        a[i - 1] === b[j - 2] &&
        a[i - 2] === b[j - 1]
      ) {
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
      }
    }
  }
  return d[n][m];
}

/**
 * Maximum edit distance tolerated for a query. Deliberately conservative:
 * short queries get no fuzzy tolerance at all.
 */
export function maxTypoDistance(query: string): number {
  if (query.length < 5) return 0;
  if (query.length < 9) return 1;
  return 2;
}

function components(branch: string): string[] {
  return branch
    .toLowerCase()
    .split(/[\/\-_.]+/)
    .filter((part) => part.length > 0);
}

/** Returns the candidates tied for the best (lowest) score within tolerance. */
function bestFuzzy(query: string, branches: string[]): string[] {
  const q = query.toLowerCase();
  const limit = maxTypoDistance(q);
  if (limit === 0) return [];
  let best = Infinity;
  let winners: string[] = [];
  for (const branch of branches) {
    let score = Infinity;
    for (const part of components(branch)) {
      score = Math.min(score, editDistance(q, part));
    }
    if (score > limit) continue;
    if (score < best) {
      best = score;
      winners = [branch];
    } else if (score === best) {
      winners.push(branch);
    }
  }
  return winners;
}

export function matchBranch(
  query: string,
  branches: string[],
): BranchMatch | null {
  if (branches.includes(query)) return { kind: "match", branch: query };

  const q = query.toLowerCase();
  const substring = branches.filter((b) => b.toLowerCase().includes(q));
  if (substring.length === 1) return { kind: "match", branch: substring[0] };
  if (substring.length > 1) return { kind: "ambiguous", candidates: substring };

  const fuzzy = bestFuzzy(query, branches);
  if (fuzzy.length === 1) return { kind: "match", branch: fuzzy[0] };
  if (fuzzy.length > 1) return { kind: "ambiguous", candidates: fuzzy };

  return null;
}
