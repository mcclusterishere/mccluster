/**
 * EQUITY UPRISE — the E=↗ lockup on the bar.
 * Mirrors equity-uprise.html: the dated record, the numbers, and the terms.
 */
import React from 'react';
import RoomContent from '../../src/RoomContent';
import { uprise } from '../../src/rooms';

export default function UpriseRoom() {
  return <RoomContent content={uprise} />;
}
