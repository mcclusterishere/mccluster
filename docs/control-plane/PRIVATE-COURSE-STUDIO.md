# Private Course Studio

**Review location:** Control → Create → Course Studio (`control.html#create:course-studio`).
This is an owner-only study aid, not an LMS connector, degree audit or credential issuer.

1. Enter a school, code, title and optional term. Choose reviewed public readings,
   or ask the form to suggest them from the course title/code and then check the match.
   The catalog starts with linear functions, elementary differentiation and atomic
   structure. A title alone is not evidence of what an instructor actually assigned.
2. Build. The canonical house-owner check runs on every request. The Worker creates
   one private course and enqueues a single opaque job in one database transaction.
   The browser does not need to stay open. Reusing the same submission ID reopens the
   same course, or returns a conflict if its content changed.
3. The existing Core lease runner fetches the selected exact public pages without any
   learner or account details. It checks the response type, bounded byte length and
   expected subject markers; a redirect, changed chapter or unavailable source fails
   closed. It saves citations, source digests and retrieval times with the bundle.
   It uses original, course-seeded numerical practice templates, not an unconstrained
   generative model. It does not ingest arbitrary URLs, scrape a school portal, execute
   page or generated code, invoke a paid provider, or infer completion of a course.
4. Open the study brief and play. Answer keys remain private until the corresponding
   server-graded response. Reloading or using a different device resumes the same
   round. Duplicating an answer cannot earn another point. A failed build can be
   retried; a previous worker cannot overwrite a newer lease.
5. The four-year pace is a planning aid: four certification exams a year, one badge
   a month. It does not aggregate official achievements, predict college credit or
   turn practice into an issuer's certification. Existing learning evidence and
   reviewed credentials retain their existing authority.

## Review and release boundary

The database proposal and its non-destructive rollback are in `supabase/pending`;
see `PROMOTION-ORDER.md`. Course data, source selections, games and answers live
only in private, service-only database rows. The operations queue receives opaque
IDs and, on success, counts/digest. No job text messages or public portfolio posts.
The Worker flag `COURSE_STUDIO_ENABLED` is **off unless explicitly enabled**.
No migrations, service promotions, flags or paid calls are part of this review.

For an isolated rehearsal: run the Core and Control tests and the disposable SQL +
lease rehearsal and browser journey from `.github/workflows/course-studio.yml`.
The default rehearsals use synthetic learner records and offline source/API fixtures.
Set `COURSE_TEST_PUBLIC_READING=1` **only with the disposable SQL harness** to
check the reviewed public chapters over HTTPS instead; all private writes still stay
inside the disposable database. The SQL script substitutes a narrow REST interface
for PostgREST and the browser test uses a synthetic API. Neither proves a running
OVH version, a production site or a real signed-in owner's session. Before release,
require an isolated deployed Core + authenticated end-to-end receipt, approval for
the pending SQL file, then normal revision-specific release checks.
