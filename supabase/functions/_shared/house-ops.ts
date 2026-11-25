// Is this signed-in user a McCluster house operator?
//
// The same rule the music desk already uses (supabase/functions/music-access,
// action "operator-status"): the capability `ops.use` on the `mccluster` org, decided by
// public.control_authorize_service from the control_role_capabilities grant matrix.
// Kept here so music-direct-access asks the same question the same way; music-access
// keeps its own inline copy unchanged. Fails closed on any error.
type Db = {
  from: (t: string) => any;
  rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }>;
};

export async function isHouseOperator(admin: Db, userId: string): Promise<boolean> {
  if (!userId) return false;
  const { data: org } = await admin.from("orgs").select("id").eq("slug", "mccluster").limit(1).maybeSingle();
  if (!org?.id) return false;
  const { data, error } = await admin.rpc("control_authorize_service", {
    p_actor: userId,
    p_org: org.id,
    p_capability: "ops.use",
    p_resource_type: null,
    p_resource_id: null,
    p_request_hash: null,
    p_approval_id: null,
  });
  if (error) return false;
  const row = Array.isArray(data) ? data[0] : data;
  return (row as { allowed?: boolean } | null)?.allowed === true;
}
