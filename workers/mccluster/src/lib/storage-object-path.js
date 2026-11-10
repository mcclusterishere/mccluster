/* Is this row value a plain Storage object path?

   The Worker's copy of supabase/functions/_shared/storage-object-path.ts,
   where each rule's reason is written once; scripts/test/
   storage-object-path.test.mjs holds this copy, the Edge one and McCluster
   Core's to one answer, case for case.

   A path stored on a row or a job is a pointer somebody wrote. A route hands
   one to Storage with the service role only when it is a plain relative object
   path (names separated by "/", none empty, "." or "..", none starting or
   ending with a space, and no control character, backslash, "%", "?" or "#")
   and the route has pinned the bucket and whose folder it must be in. */
const NOT_IN_A_NAME = /[\u0000-\u001f\u007f-\u009f\u2028\u2029\\%?#]/;
const NOT_A_SEGMENT = /(?:^|\/)(?: |\.{0,2}(?:\/|$))| (?:\/|$)/;
const LONE_SURROGATE = /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/;

export function safeObjectPath(path) {
  return typeof path === 'string' && !NOT_IN_A_NAME.test(path) && !NOT_A_SEGMENT.test(path) && !LONE_SURROGATE.test(path);
}
