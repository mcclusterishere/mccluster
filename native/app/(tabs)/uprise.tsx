/**
 * EQUITY UPRISE — the E=↗ lockup on the bar.
 * Mirrors equity-uprise.html. Content not yet carried over.
 */
import React from 'react';
import RoomScreen from '../../src/RoomScreen';

export default function UpriseRoom() {
  return (
    <RoomScreen
      kicker="A McCluster Corp program"
      title="Equity Uprise"
      lede="Business development, workforce development, digital capacity building. No stock, no ownership — a time-limited revenue-share agreement."
      page="equity-uprise.html"
      pending={[
        'Where the paper starts',
        'The nine fellows',
        'October 5, Bridgeport — the citation record',
        'Ways in',
      ]}
    />
  );
}
