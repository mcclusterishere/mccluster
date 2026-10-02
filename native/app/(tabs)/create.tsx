/**
 * CREATE — the record button on the bar.
 * Mirrors create.html: record with the phone's own camera, trim, caption,
 * then post to the Action Network now or at a chosen time. The native
 * capture screen is not built yet, so this room opens the web flow.
 */
import React from 'react';
import RoomScreen from '../../src/RoomScreen';

export default function CreateRoom() {
  return (
    <RoomScreen
      kicker="The Action Network"
      title="Create"
      lede="Record it, trim it, say what it is, and post it now or later."
      page="create.html"
      pending={[
        'Native camera capture',
        'The trim and caption editor',
        'Post now or schedule',
      ]}
    />
  );
}
