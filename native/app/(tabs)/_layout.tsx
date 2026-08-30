/**
 * THE ONE BAR — the house's five rooms, in the house's own bar.
 *
 * Not a tab bar designed for this app. This is `.appbar`, the same
 * navigation that sits on all thirty-nine pages of the site: a floating
 * blurred pill, clear of both edges, holding five circular emblem coins.
 * The active room fills with the metal gradient, which is the red coin in
 * the middle of the real bar.
 *
 * The route names match the site's rooms, so the app's information
 * architecture is the site's — Music, Equity Uprise, HERE, Prayer Closet,
 * Profile — rather than a music-player IA invented for a phone.
 *
 * Films / Catalog / License are still real screens; they moved OFF the bar
 * and belong inside the Music room, which is where they live on the web
 * (album.html links out to films.html, catalogue.html, license.html).
 */
import React from 'react';
import { Tabs, useRouter } from 'expo-router';
import { View, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import MiniTransport from '../../src/MiniTransport';
import { Glass } from '../../src/Glass';
import { AppBarTab, ROOMS, type RoomKey } from '../../src/AppBar';
import { useTransport } from '../../src/player';
import { space } from '../../src/theme';

export default function TabsLayout() {
  const insets = useSafeAreaInsets();

  return (
    <Tabs
      tabBar={(props) => <HouseBar {...props} insetBottom={insets.bottom} />}
      screenOptions={{ headerShown: false }}
    >
      <Tabs.Screen name="music" options={{ title: 'Music' }} />
      <Tabs.Screen name="uprise" options={{ title: 'Equity Uprise' }} />
      <Tabs.Screen name="here" options={{ title: 'HERE' }} />
      <Tabs.Screen name="closet" options={{ title: 'Prayer Closet' }} />
      <Tabs.Screen name="profile" options={{ title: 'Profile' }} />
      {/* rooms inside Music, reachable but not on the bar */}
      <Tabs.Screen name="films" options={{ href: null }} />
      <Tabs.Screen name="catalogue" options={{ href: null }} />
      <Tabs.Screen name="license" options={{ href: null }} />
      <Tabs.Screen name="desk" options={{ href: null }} />
    </Tabs>
  );
}

function HouseBar({ state, navigation, insetBottom }: any) {
  const { status } = useTransport();

  /* which of the five rooms is lit; screens that are not on the bar
     (films, catalogue, license) keep the Music coin lit, because that is
     the room they belong to */
  const activeRoute = state.routes[state.index]?.name as string;
  const activeRoom: RoomKey =
    activeRoute === 'uprise' ? 'uprise'
      : activeRoute === 'here' ? 'here'
      : activeRoute === 'closet' ? 'closet'
      : activeRoute === 'profile' ? 'profile'
      : 'music';

  return (
    <View style={s.stack} pointerEvents="box-none">
      <View style={s.deckSlot}>
        <MiniTransport />
      </View>
      <Glass
        variant="bar"
        radius={999}
        style={[s.pill, { marginBottom: Math.max(insetBottom, space.sm) }]}
      >
        <View style={s.row}>
          {ROOMS.map((room) => (
            <AppBarTab
              key={room.key}
              room={room.key}
              active={activeRoom === room.key}
              playing={room.key === 'music' && status.playing}
              onPress={() => navigation.navigate(room.key)}
            />
          ))}
        </View>
      </Glass>
    </View>
  );
}

const s = StyleSheet.create({
  stack: { position: 'absolute', left: 0, right: 0, bottom: 0 },
  deckSlot: { paddingHorizontal: space.md, marginBottom: space.sm },
  /* floats clear of both edges — never edge to edge */
  pill: { marginHorizontal: space.lg },
  row: { flexDirection: 'row', paddingHorizontal: 5, paddingVertical: 5 },
});
