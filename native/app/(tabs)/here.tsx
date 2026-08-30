/**
 * HERE — the home room, the M coin at the centre of the bar.
 * Mirrors index.html. Content not yet carried over; see src/RoomScreen.
 */
import React from 'react';
import RoomScreen from '../../src/RoomScreen';

export default function HereRoom() {
  return (
    <RoomScreen
      kicker="Direction · Photo · Web · Music"
      title={'McCluster\nCorp'}
      lede="One person, the whole job. Five government citations on the record."
      emblem={require('../../assets/emblems/m-mark.png')}
      page="index.html"
      pending={[
        'The orbiting hero film and the cinematic intro',
        'The three frequencies — Web Design, Film, Sound',
        'The timeline, the receipts and the wall',
      ]}
    />
  );
}
