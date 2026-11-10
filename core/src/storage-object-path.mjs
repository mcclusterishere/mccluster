/* Is this row value a plain Storage object path?
 *
 * Core's copy of supabase/functions/_shared/storage-object-path.ts, where each
 * rule's reason is written once. Core is deployed from core/ alone, so it
 * carries the rule itself; scripts/test/storage-object-path.test.mjs holds this
 * copy, the Edge one and the Worker's to one answer, case for case.
 *
 * A bucket and path stored on a row are a pointer somebody wrote. Core follows
 * one with its service key only when the path is a plain relative object path
 * (names separated by "/", none empty, "." or "..", none starting or ending
 * with a space, and no control character, backslash, "%", "?" or "#") and the
 * caller has pinned the bucket.
 */
const NOT_IN_A_NAME = /[\u0000-\u001f\u007f-\u009f\u2028\u2029\\%?#]/;
const NOT_A_SEGMENT = /(?:^|\/)(?: |\.{0,2}(?:\/|$))| (?:\/|$)/;
const LONE_SURROGATE = /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/;

export function safeObjectPath(path) {
  return typeof path === 'string' && !NOT_IN_A_NAME.test(path) && !NOT_A_SEGMENT.test(path) && !LONE_SURROGATE.test(path);
}
