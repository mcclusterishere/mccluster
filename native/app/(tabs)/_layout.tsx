/**
 * THE ONE BAR — the same three primary rooms as the web shell.
 *
 * Music · HERE · Mnet/Profile are the only persistent bar destinations.
 * Equity Uprise and Prayer Closet remain built routes, but they are hidden
 * from the bar until the owner explicitly restores them to primary navigation.
 *
 * Films / Catalog / License and Desk remain reachable screens inside the app
 * without becoming additional bar tabs.
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
      <Tabs.Screen name="here" options={{ title: 'HERE' }} />
      <Tabs.Screen name="profile" options={{ title: 'Mnet' }} />
      {/* preserved rooms/screens that are reachable but not on the primary bar */}
      <Tabs.Screen name="uprise" options={{ href: null }} />
      <Tabs.Screen name="closet" options={{ href: null }} />
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

  /* Only the three primary rooms can light a bar coin. Music child screens
     inherit Music; hidden Uprise/Closet routes intentionally light none. */
  const activeRoute = state.routes[state.index]?.name as string;
  const activeRoom: RoomKey | null =
    activeRoute === 'here' ? 'here'
      : activeRoute === 'profile' ? 'profile'
      : ['music', 'films', 'catalogue', 'license'].includes(activeRoute) ? 'music'
      : null;

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
