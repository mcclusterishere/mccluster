/**
 * PRAYER CLOSET — the HM mark on the bar.
 * Mirrors prayer-closet.html. Content not yet carried over.
 */
import React from 'react';
import RoomScreen from '../../src/RoomScreen';

export default function ClosetRoom() {
  return (
    <RoomScreen
      kicker="Have no fear"
      title="Prayer Closet"
      lede="The room the house keeps for the work that isn't for sale."
      pulse="#ff5c2e"
      emblem={require('../../assets/emblems/hm-mark.png')}
      page="prayer-closet.html"
      pending={[
        'The drops and the edition format',
        'The tiers and the collaborators',
        'Scripture, the seasons and the bench',
      ]}
    />
  );
}
