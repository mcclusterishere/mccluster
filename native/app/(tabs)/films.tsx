/**
 * FILMS — a one-screen vertical viewer.
 *
 * Native mobile law: "Films is a full-screen vertical viewer" and
 * "horizontal paging is reserved for browsable siblings; vertical scrolling
 * advances the current task." So this pages vertically, one film per screen,
 * snapped — the grammar the whole phone already uses for full-screen video.
 *
 * Brand library rule 4: audio begins only after visitor intent. The video
 * that owns the screen plays muted until the viewer presses Sound, and only
 * the visible one is ever playing.
 */
import React, { useCallback, useRef, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { album, type Track } from '../../src/content';
import { color, radius, space, type, MIN_TOUCH } from '../../src/theme';

export default function FilmsScreen() {
  const { height, width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  /* the bar and the transport sit over the bottom; a film's page is the
     screen minus that chrome, so a snap lands a whole film every time */
  const page = height - insets.bottom - 56;
  const [index, setIndex] = useState(0);
  const [sound, setSound] = useState(false);

  const onScroll = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      const i = Math.round(e.nativeEvent.contentOffset.y / page);
      setIndex((prev) => (prev === i ? prev : i));
    },
    [page],
  );

  return (
    <View style={s.screen}>
      <ScrollView
        pagingEnabled
        snapToInterval={page}
        decelerationRate="fast"
        showsVerticalScrollIndicator={false}
        onMomentumScrollEnd={onScroll}
      >
        {album.tracks.map((t, i) => (
          <Film
            key={t.slug}
            track={t}
            height={page}
            width={width}
            active={i === index}
            sound={sound}
            onToggleSound={() => setSound((v) => !v)}
            topInset={insets.top}
            position={`${i + 1} / ${album.tracks.length}`}
          />
        ))}
      </ScrollView>
    </View>
  );
}

function Film({
  track,
  height,
  width,
  active,
  sound,
  onToggleSound,
  topInset,
  position,
}: {
  track: Track;
  height: number;
  width: number;
  active: boolean;
  sound: boolean;
  onToggleSound: () => void;
  topInset: number;
  position: string;
}) {
  const player = useVideoPlayer(track.video ?? null, (p) => {
    p.loop = true;
    p.muted = true;
  });

  /* only the film on screen plays, and sound is never assumed */
  React.useEffect(() => {
    player.muted = !sound || !active;
    if (active) player.play();
    else player.pause();
  }, [active, sound, player]);

  return (
    <View style={[s.film, { height, width }]}>
      <VideoView
        player={player}
        style={StyleSheet.absoluteFill}
        contentFit="cover"
        nativeControls={false}
      />
      <View style={s.filmVeil} pointerEvents="none" />

      <View style={[s.filmTop, { paddingTop: topInset + space.md }]}>
        <Text style={s.counter}>{position}</Text>
        <Pressable
          onPress={onToggleSound}
          style={[s.soundBtn, sound && s.soundOn]}
          accessibilityRole="button"
          accessibilityLabel={sound ? 'Mute' : 'Turn sound on'}
        >
          <Text style={[s.soundText, sound && s.soundTextOn]}>
            {sound ? 'Sound on' : 'Sound'}
          </Text>
        </Pressable>
      </View>

      <View style={s.filmBottom}>
        <Text style={[s.filmKicker, { color: track.pulse }]}>{track.stage}</Text>
        <Text style={s.filmTitle} allowFontScaling={false}>
          {track.title}
        </Text>
        <Text style={s.filmSub}>{album.name}</Text>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#000' },
  film: { backgroundColor: '#000', justifyContent: 'flex-end' },
  filmVeil: {
    ...StyleSheet.absoluteFill as object,
    backgroundColor: 'rgba(10,8,7,0.28)',
  },
  filmTop: {
    position: 'absolute',
    top: 0,
    left: space.gutter,
    right: space.gutter,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  counter: { ...type.mono, color: color.paper, opacity: 0.8 },
  soundBtn: {
    minHeight: 34,
    paddingHorizontal: space.lg,
    justifyContent: 'center',
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: 'rgba(244,239,230,0.4)',
    backgroundColor: 'rgba(10,8,7,0.5)',
  },
  soundOn: { backgroundColor: color.ruby, borderColor: 'transparent' },
  soundText: { ...type.label, fontSize: 10, color: color.paper },
  soundTextOn: { color: '#fff' },
  filmBottom: { padding: space.gutter, paddingBottom: space.xxl },
  filmKicker: { ...type.label },
  filmTitle: { ...type.display, color: color.paper, marginTop: space.sm },
  filmSub: { ...type.sub, color: color.paper, opacity: 0.7, marginTop: 4 },
});
