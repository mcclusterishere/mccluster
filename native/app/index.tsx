/**
 * The front door of the app.
 *
 * The site's own home is index.html — the HERE room, the M coin at the
 * centre of the bar — and the app's information architecture follows the
 * site's. But HERE's content is not carried over yet, and opening a music
 * app on a room that only says "not built yet" would be a worse first
 * impression than opening on the room that is genuinely finished.
 *
 * So the app lands on Music for now. When the HERE room is actually built,
 * this redirect points at `/here` and the app opens where the site does.
 */
import { Redirect } from 'expo-router';

export default function Entry() {
  return <Redirect href="/music" />;
}
