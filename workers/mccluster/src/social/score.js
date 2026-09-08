// SCORE — how a post's performance becomes one number.
//
// Extracted from social/router.js so it can be tested. It used to sit in
// a module that imports the fal.ai client, which meant importing it
// pulled in a network SDK and a dependency that is not installed in this
// repo — so the one piece of genuinely testable logic in the social
// engine had no tests. A pure function should never be behind an import
// chain like that.
//
// WHAT THIS MEASURES, AND WHAT IT CURRENTLY CANNOT
// ------------------------------------------------
// The weights say conversion (25%) and retention (20%) are nearly half
// the score. The automatic Instagram sync does not yet collect them: it
// writes follows, dms, leads and watch time as 0 and retention as null.
//
// So on provider-synced data the score is really 55% of itself — views
// and engagement — with two large terms pinned at zero. That is fine as
// a relative ranking between posts measured the same way, and wrong the
// moment provider-synced posts are compared against manually-entered
// ones that DO carry conversion numbers.
//
// Fixing that is an ingestion problem, not a formula problem. Until
// then, treat cross-source comparisons as meaningless and read
// `components` rather than the single number.

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

/**
 * A metric as a non-negative finite number, or zero.
 *
 * The original code wrote `Math.max(0, Number(value || 0))` for each
 * field, which looks like it clamps and does not: `Math.max(0, NaN)` is
 * NaN, not 0. So a single non-numeric value — `"banana"`, `"12k"`, an
 * object from a malformed provider payload — turned the whole score into
 * NaN.
 *
 * That is worse than a wrong number. The NaN is written to
 * `social_metric_snapshots.score` AND copied onto
 * `social_variants.score`, and the variant score is what the generator
 * orders by when it picks the top five performers to learn from. One bad
 * value silently corrupts the input to every future generation, and
 * nothing raises, because NaN compares false against everything and just
 * sorts to one end.
 *
 * Metrics reach this function from an authenticated API endpoint as well
 * as from the Instagram sync, so "the provider always sends numbers" was
 * never the whole story.
 */
function num(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

export function scoreMetrics(metrics = {}) {
  const views = num(metrics.views);
  // reach falls back to views when absent, so a post with reach 0 is not
  // treated as infinitely converting.
  const reach = num(metrics.reach) || views;
  const likes = num(metrics.likes);
  const comments = num(metrics.comments);
  const shares = num(metrics.shares);
  const saves = num(metrics.saves);
  const follows = num(metrics.follows);
  const dms = num(metrics.dms);
  const leads = num(metrics.leads);
  const retention = metrics.retention_3s == null ? 0 : clamp(num(metrics.retention_3s), 0, 1);

  // Log scale: the difference between 100 and 1,000 views matters more
  // than between 100,000 and 101,000.
  const viewScore = clamp(Math.log10(views + 1) * 20, 0, 100);
  // Weighted by how much intent each action shows. A share or a save
  // costs the viewer something; a like does not.
  const engagementScore = clamp(((likes + comments * 2 + shares * 4 + saves * 4) / Math.max(views, 1)) * 1000, 0, 100);
  const conversionScore = clamp(((follows * 4 + dms * 8 + leads * 15) / Math.max(reach, 1)) * 1000, 0, 100);
  const retentionScore = retention * 100;

  const score = Number(
    (viewScore * 0.20 + engagementScore * 0.35 + conversionScore * 0.25 + retentionScore * 0.20).toFixed(3)
  );

  return {
    score,
    components: {
      views: Number(viewScore.toFixed(3)),
      engagement: Number(engagementScore.toFixed(3)),
      conversion: Number(conversionScore.toFixed(3)),
      retention: Number(retentionScore.toFixed(3))
    }
  };
}
