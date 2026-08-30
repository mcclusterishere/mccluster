/**
 * The record, as the app knows it.
 *
 * The shape mirrors data/albums.json in the repo root, which is still the
 * source of truth for the web side. `npm run sync-content` regenerates the
 * album constant below from that file so the two can never drift by hand.
 *
 * Media streams rather than ships: the six masters are 3.7–5 MB each and the
 * full audio directory is 64 MB, which is not something to put inside a
 * download. They come off the house origin, which is where the web player
 * already reads them from.
 */

export const ORIGIN = 'https://matthew.mccluster.org';

const media = (path: string) => `${ORIGIN}/${path}`;

/** the emblem, top-left on every page */
export const M_MARK = media('assets/img/m-mark.png');

export type Track = {
  slug: string;
  title: string;
  sub?: string;
  /** the streamed master */
  src: string;
  /** the room's moving wallpaper, used by the Now Playing stage */
  video?: string;
  /** first frame of that video — the still the stage opens on */
  poster: string;
  /** each song's own accent, from the album ledger */
  pulse: string;
  /** the authored premise of the room, from the brand library */
  stage: string;
  /** written for the credit ledger, not decoration */
  credit: string;
};

export type Album = {
  slug: string;
  name: string;
  tag: string;
  by: string;
  art: string;
  tracks: Track[];
};

/**
 * Stage descriptions come from the brand library's Song Stage section:
 * "Who Did The Shoot: production dossier. Runway Walk: wide runway field.
 * Write a Song: session sheet. Here: manifesto. Antisocial: midnight scroll.
 * Lightroom: edit log."
 */
export const album: Album = {
  slug: 'here',
  name: 'I AM HERE',
  tag: 'The album · 6 tracks',
  by: 'Have no fear.',
  art: media('assets/img/here-cover.jpg'),
  tracks: [
    {
      slug: 'who-did-the-shoot',
      title: 'Who Did The Shoot',
      src: media('assets/audio/who-did-the-shoot.mp3'),
      video: media('assets/video/hero.mp4'),
      poster: media('assets/frames/hero_0001.jpg'),
      pulse: '#e5383b',
      stage: 'Production dossier',
      credit: 'Written, performed and produced by Matthew McCluster',
    },
    {
      slug: 'runway-walk',
      title: 'Runway Walk',
      src: media('assets/audio/runway-walk.mp3'),
      video: media('assets/video/vauntlive.mp4'),
      poster: media('assets/frames/vauntlive_0001.jpg'),
      pulse: '#ff5a5c',
      stage: 'Wide runway field',
      credit: 'Written, performed and produced by Matthew McCluster',
    },
    {
      slug: 'write-a-song',
      title: 'Write a Song',
      src: media('assets/audio/write-a-song.mp3'),
      video: media('assets/video/studio360.mp4'),
      poster: media('assets/frames/studio360_0001.jpg'),
      pulse: '#c1121f',
      stage: 'Session sheet',
      credit: 'Written, performed and produced by Matthew McCluster',
    },
    {
      slug: 'here',
      title: 'Here',
      sub: 'the title track',
      src: media('assets/audio/here.mp3'),
      video: media('assets/video/keynote.mp4'),
      poster: media('assets/frames/keynote_0001.jpg'),
      pulse: '#ff3040',
      stage: 'Manifesto',
      credit: 'Written, performed and produced by Matthew McCluster',
    },
    {
      slug: 'antisocial',
      title: 'Antisocial',
      src: media('assets/audio/antisocial.mp3'),
      video: media('assets/video/nightscroll.mp4'),
      poster: media('assets/frames/nightscroll_0001.jpg'),
      pulse: '#8f0f16',
      stage: 'Midnight scroll',
      credit: 'Written, performed and produced by Matthew McCluster',
    },
    {
      slug: 'lightroom',
      title: 'Lightroom',
      src: media('assets/audio/lightroom.mp3'),
      video: media('assets/video/editors.mp4'),
      poster: media('assets/frames/editors_0001.jpg'),
      pulse: '#f0453f',
      stage: 'Edit log',
      credit: 'Written, performed and produced by Matthew McCluster',
    },
  ],
};

/**
 * THE CURATED RAIL — "Curated by the house" on album.html: a horizontal
 * shelf of every release, art first, before the record you're currently in.
 * Real catalog entries from data/albums.json, not invented ones. Only "I AM
 * HERE" has full track data ported to the app so far; the rest carry enough
 * to render the shelf and are not yet playable — tapping one is out of
 * scope for this pass and is noted as a known gap, not silently stubbed.
 */
export type LibraryEntry = { slug: string; name: string; tag: string; art: string; playable: boolean };

export const library: LibraryEntry[] = [
  { slug: 'here', name: 'I AM HERE', tag: 'The album · 6 tracks', art: media('assets/img/here-cover.jpg'), playable: true },
  { slug: 'prim3', name: 'PRIM3', tag: 'The study tapes', art: media('assets/img/prim3-logo.png'), playable: false },
  { slug: 'equity-uprise', name: 'Equity Uprise', tag: 'The civic anthems · 4 tracks', art: media('assets/img/equity-uprise-logo.webp'), playable: false },
  { slug: 'heal-the-3', name: 'Heal the 3', tag: 'The EP · with VVS Madè', art: media('assets/img/heal-the-3-cover.jpg'), playable: false },
  { slug: 'vaunt-ep', name: 'Vaunt EP', tag: 'The campaign jingle', art: media('assets/img/vaunt-logo.webp'), playable: false },
  { slug: 'whip-equipped', name: 'Whip Equipped', tag: 'The dealership saga', art: media('assets/img/wing-whip-poster.jpg'), playable: false },
];

export const trackBySlug = (slug: string) =>
  album.tracks.find((t) => t.slug === slug);

export const trackIndex = (slug: string) =>
  album.tracks.findIndex((t) => t.slug === slug);

/** mm:ss, and never NaN on a stream that has not reported duration yet */
export function clock(seconds: number | undefined | null): string {
  if (seconds == null || !isFinite(seconds) || seconds < 0) return '--:--';
  const whole = Math.floor(seconds);
  const m = Math.floor(whole / 60);
  const s = whole % 60;
  return `${m}:${s < 10 ? '0' : ''}${s}`;
}
