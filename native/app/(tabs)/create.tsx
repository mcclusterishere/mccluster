/**
 * CREATE — the record button on the bar.
 * Mirrors create.html: record with the phone's own camera, trim, caption,
 * then post to the Action Network now or at a chosen time. The native
 * capture/editor remains canonical in the hardened web flow so web and native
 * cannot diverge on upload, trim, scheduling, draft recovery, or retries.
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
        'Uses the same hardened camera and library flow as web',
        'Draft recovery and interrupted-upload retry',
        'Post now or schedule with the same server contract',
      ]}
    />
  );
}
