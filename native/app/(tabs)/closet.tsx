/**
 * PRAYER CLOSET — the HM mark on the bar.
 * Mirrors prayer-closet.html: Season 001 and the rooms inside it.
 */
import React from 'react';
import RoomContent from '../../src/RoomContent';
import { closet } from '../../src/rooms';

export default function ClosetRoom() {
  return (
    <RoomContent
      content={closet}
      pulse="#ff5c2e"
      emblem={require('../../assets/emblems/hm-mark.png')}
    />
  );
}
