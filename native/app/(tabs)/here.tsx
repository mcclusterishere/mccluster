/**
 * HERE — the home room, the M coin at the centre of the bar.
 * Mirrors index.html: the four branches of the work and the identity of record.
 */
import React from 'react';
import RoomContent from '../../src/RoomContent';
import { here } from '../../src/rooms';

export default function HereRoom() {
  return <RoomContent content={here} emblem={require('../../assets/emblems/m-mark.png')} />;
}
