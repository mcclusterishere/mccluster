/* This receipt records the authenticated publisher's exact review action.
   It is not an assertion that an AI has verified the story's truth. */
export async function newsroomRevision(row) {
  const m = row.metadata || {};
  const text = JSON.stringify({ schema: 'newsroom-review/1', body: String(row.body || '').trim(), visibility: row.visibility,
    group_id: row.group_id || null, reply_to_id: row.reply_to_id || null,
    note: m.newsroom_note || null, sources: m.newsroom_sources || [] });
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))].map((x) => x.toString(16).padStart(2, '0')).join('');
}
export async function approveNewsroomRevision(row, actor, now = Date.now()) {
  return { schema: 'newsroom-review/1', state: 'approved', revision_sha256: await newsroomRevision(row),
    reviewer_m_uid: actor, reviewed_at: new Date(now).toISOString() };
}
export async function hasNewsroomApproval(row) {
  const review = row?.metadata?.newsroom_review;
  return !!(review && review.schema === 'newsroom-review/1' && review.state === 'approved' &&
    review.reviewer_m_uid === row.author_m_uid && Number.isFinite(Date.parse(review.reviewed_at)) &&
    review.revision_sha256 === await newsroomRevision(row));
}
export async function newsroomPostId(actor, revision) {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(['newsroom-post/1', actor, revision]))));
  bytes[6] = (bytes[6] & 15) | 0x50; bytes[8] = (bytes[8] & 63) | 0x80;
  const h = [...bytes.slice(0, 16)].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
