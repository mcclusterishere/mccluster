// Is this row value a plain Storage object path?
//
// A path stored on a row is a pointer somebody wrote, not a fact about what
// was uploaded. Before a function hands one to Storage with the service role
// it must be a plain relative object path: names separated by "/", none of
// them empty, "." or "..", and no character that a URL parser, a proxy or the
// Storage API reads as structure rather than as part of a name. A value that
// passes names the same object however it is sent: in a JSON body, encoded
// segment by segment, or placed in a URL as it is
// (scripts/test/storage-object-path.test.mjs checks that against the URL parser).
//
// Callers still pin the bucket themselves; this is only about the path.
//
// The same rule runs in McCluster Core (core/src/storage-object-path.mjs) and
// in the Worker (workers/mccluster/src/lib/storage-object-path.js): three
// deployables, three copies, held to one answer case for case by
// scripts/test/storage-object-path.test.mjs.

// Never part of a name here: the C0 and C1 controls and DEL (a URL parser
// drops tab and newline outright), the line and paragraph separators,
// backslash (a URL parser reads it as "/"), "%" (an encoded name decodes to a
// different one further on), "?" and "#" (they end the path).
const NOT_IN_A_NAME = /[\u0000-\u001f\u007f-\u009f\u2028\u2029\\%?#]/;
// A segment that is empty, "." or "..", or that starts or ends with a space: a
// URL parser trims a space from the end of a URL, so a name ending in one is
// sent as a different name. This is also the empty string, a leading "/", a
// trailing "/", a blank segment and dots padded with spaces.
const NOT_A_SEGMENT = /(?:^|\/)(?: |\.{0,2}(?:\/|$))| (?:\/|$)/;
// Half of a surrogate pair on its own: not text that can be encoded as it is.
// A URL parser replaces it, so the name changes; encodeURIComponent throws.
const LONE_SURROGATE = /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/;

export function safeObjectPath(path: unknown): path is string {
  return typeof path === "string" && !NOT_IN_A_NAME.test(path) && !NOT_A_SEGMENT.test(path) && !LONE_SURROGATE.test(path);
}
