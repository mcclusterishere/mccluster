/**
 * THE TRANSPORT — one player, one queue, the whole app.
 *
 * This is the reason the record is an app and not a page. A browser tab
 * cannot keep playing when the phone locks, cannot put the artwork and the
 * title on the lock screen, and cannot take a press on the headphone button.
 * expo-audio can, and this module is where that happens:
 *
 *   setAudioModeAsync({ shouldPlayInBackground: true, interruptionMode:
 *   'doNotMix' })  — the app keeps the audio session when it leaves the
 *   foreground, and does not duck under other apps.
 *
 *   player.setActiveForLockScreen(true, { title, artist, albumTitle,
 *   artworkUrl })  — the record's own metadata on the lock screen and in the
 *   notification shade. On Android this call is also what keeps playback
 *   alive past roughly three minutes in the background.
 *
 * One AudioPlayer instance lives for the life of the app and is handed the
 * next source with replace(), rather than a new player per screen. That is
 * what makes the transport persistent: leaving a track room does not stop
 * the song, which is the behaviour the brand library asks for when it says
 * the Music tab stays a transport wherever a playable deck exists.
 */
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  createAudioPlayer,
  setAudioModeAsync,
  type AudioPlayer,
} from 'expo-audio';
import { album, trackIndex, type Track } from './content';

type Status = {
  playing: boolean;
  isLoaded: boolean;
  isBuffering: boolean;
  currentTime: number;
  duration: number;
};

type Transport = {
  /** the track on the deck, or null before anything has been chosen */
  current: Track | null;
  status: Status;
  /** play this track; if it is already on the deck, just resume */
  load: (track: Track, autoplay?: boolean) => void;
  toggle: () => void;
  play: () => void;
  pause: () => void;
  seekTo: (seconds: number) => void;
  next: () => void;
  previous: () => void;
  /** true once a track has been loaded, so chrome can make room for the bar */
  hasDeck: boolean;
};

const EMPTY: Status = {
  playing: false,
  isLoaded: false,
  isBuffering: false,
  currentTime: 0,
  duration: 0,
};

const Ctx = createContext<Transport | null>(null);

export function TransportProvider({ children }: { children: React.ReactNode }) {
  const playerRef = useRef<AudioPlayer | null>(null);
  const [current, setCurrent] = useState<Track | null>(null);
  const [status, setStatus] = useState<Status>(EMPTY);

  /* the session is claimed once, before anything is loaded */
  useEffect(() => {
    setAudioModeAsync({
      playsInSilentMode: true,
      shouldPlayInBackground: true,
      interruptionMode: 'doNotMix',
    }).catch(() => {
      /* a refused audio session must not take the screen down with it */
    });
  }, []);

  /* one player for the life of the app */
  const player = useMemo(() => {
    const p = createAudioPlayer(null);
    playerRef.current = p;
    return p;
  }, []);

  useEffect(() => {
    const sub = player.addListener('playbackStatusUpdate', (s: any) => {
      setStatus({
        playing: !!s?.playing,
        isLoaded: !!s?.isLoaded,
        isBuffering: !!s?.isBuffering,
        currentTime: Number(s?.currentTime ?? 0),
        duration: Number(s?.duration ?? 0),
      });
      /* a finished track rolls into the next one, the way a record does */
      if (s?.didJustFinish) advance(1);
    });
    return () => {
      sub?.remove?.();
      player.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [player]);

  const stamp = useCallback(
    (track: Track) => {
      /* the lock screen gets the record's own metadata, not the app name */
      try {
        player.setActiveForLockScreen(true, {
          title: track.title,
          artist: 'Matthew McCluster',
          albumTitle: album.name,
          artworkUrl: album.art,
        });
      } catch {
        /* older runtimes without lock-screen support still play */
      }
    },
    [player],
  );

  const load = useCallback(
    (track: Track, autoplay = true) => {
      if (current?.slug === track.slug) {
        if (autoplay) player.play();
        return;
      }
      setCurrent(track);
      setStatus((s) => ({ ...s, isLoaded: false, currentTime: 0, duration: 0 }));
      player.replace({ uri: track.src });
      stamp(track);
      if (autoplay) player.play();
    },
    [current, player, stamp],
  );

  /* next/previous walk the album in order and wrap, so the deck never dead-ends */
  const advance = useCallback(
    (delta: number) => {
      setCurrent((now) => {
        if (!now) return now;
        const i = trackIndex(now.slug);
        if (i < 0) return now;
        const nextTrack =
          album.tracks[(i + delta + album.tracks.length) % album.tracks.length];
        player.replace({ uri: nextTrack.src });
        stamp(nextTrack);
        player.play();
        return nextTrack;
      });
    },
    [player, stamp],
  );

  const value = useMemo<Transport>(
    () => ({
      current,
      status,
      load,
      play: () => player.play(),
      pause: () => player.pause(),
      toggle: () => (status.playing ? player.pause() : player.play()),
      seekTo: (seconds: number) => {
        void player.seekTo(Math.max(0, seconds));
      },
      next: () => advance(1),
      previous: () => {
        /* the familiar rule: past three seconds, previous restarts the song */
        if (status.currentTime > 3) {
          void player.seekTo(0);
          return;
        }
        advance(-1);
      },
      hasDeck: current !== null,
    }),
    [current, status, load, player, advance],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useTransport(): Transport {
  const v = useContext(Ctx);
  if (!v) throw new Error('useTransport must be used inside TransportProvider');
  return v;
}
