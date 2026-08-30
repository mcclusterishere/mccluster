/**
 * PROFILE — the account coin on the bar.
 * Mirrors account.html. Auth is real in the app (Supabase, via
 * src/player's session) but the account surface is not built yet.
 */
import React from 'react';
import RoomScreen from '../../src/RoomScreen';

export default function ProfileRoom() {
  return (
    <RoomScreen
      kicker="The desk"
      title="Profile"
      lede="Your account, your engagement, and everything filed with the studio."
      page="account.html"
      ported={[
        'Background playback, lock-screen controls and the transport',
      ]}
      pending={[
        'Sign in and the person account',
        'The client console and filed requests',
        'The E⤴ Card and the imprint',
      ]}
    />
  );
}
