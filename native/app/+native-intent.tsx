/**
 * Normalize legacy/shared web receipts into native Expo Router paths.
 *
 * here://mission/<id> already maps directly through Expo Router. The public
 * website still shares matthew.mccluster.org/mnet.html?mission=<id>, so once
 * iOS/Android domain association is verified that HTTPS URL lands on the
 * exact same native mission screen.
 */
export function redirectSystemPath({
  path,
}: {
  path: string;
  initial: boolean;
}): string {
  try {
    const url = new URL(path, 'here://app');
    const isActionNetworkWeb =
      url.hostname.toLowerCase() === 'matthew.mccluster.org' &&
      url.pathname === '/mnet.html';
    const mission = url.searchParams.get('mission');

    if (
      isActionNetworkWeb &&
      mission &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(mission)
    ) {
      return `/mission/${mission}`;
    }

    return path;
  } catch {
    // Never crash app startup because an external application supplied a
    // malformed URL. Fall back to the Network room.
    return '/profile';
  }
}
