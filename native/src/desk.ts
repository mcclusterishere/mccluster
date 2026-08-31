/**
 * The desk — where a licensing brief actually goes.
 *
 * The licence screen used to call setSent(true) and print a reference built
 * from Date.now(), telling the customer their brief was filed when nothing had
 * been transmitted or stored. This is the client for the endpoint that files
 * it for real, and the reference it shows now comes back from the server.
 */
import Constants from 'expo-constants';

/**
 * McCluster Core. Set `extra.coreUrl` in app.json, or EXPO_PUBLIC_CORE_URL at
 * build time, to point a build at a different environment.
 */
export const CORE_URL: string =
  (Constants.expoConfig?.extra as { coreUrl?: string } | undefined)?.coreUrl ||
  process.env.EXPO_PUBLIC_CORE_URL ||
  'https://api.mccluster.org';

export type Brief = {
  trackSlug: string;
  use: string;
  term: string;
  who: string;
  email: string;
  note?: string;
};

export type Filed = { reference: string; status: string };

/** File a licensing brief. Throws with a message worth showing the customer. */
export async function fileBrief(brief: Brief): Promise<Filed> {
  let response: Response;
  try {
    response = await fetch(`${CORE_URL}/v1/licensing/briefs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        track_slug: brief.trackSlug,
        use: brief.use,
        term: brief.term,
        who: brief.who.trim(),
        email: brief.email.trim(),
        note: brief.note?.trim() || undefined,
      }),
    });
  } catch {
    throw new Error('We could not reach the desk. Your brief has not been sent — check your connection and try again.');
  }

  const data = await response.json().catch(() => ({} as Record<string, unknown>));
  if (!response.ok) {
    throw new Error(
      (data as { error?: string }).error ||
        'We could not file your brief. Nothing was sent — please try again.'
    );
  }
  return { reference: String((data as Filed).reference), status: String((data as Filed).status || 'received') };
}
