import React from 'react';
import { FlatList, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { Empty, ErrorState, Loading } from '../components/States';
import { colors, radius, spacing } from '../theme/theme';

export function ProfileScreen() {
  const { user, signOut } = useAuth();

  const me = useQuery({ queryKey: ['me'], queryFn: api.me });
  const grid = useQuery({ queryKey: ['myCompletions'], queryFn: () => api.myCompletions() });

  if (me.isPending || grid.isPending) return <Loading />;
  if (me.isError) {
    return <ErrorState message={(me.error as Error).message} onRetry={() => me.refetch()} />;
  }

  return (
    <SafeAreaView style={styles.flex} edges={['top']}>
      <FlatList
        data={grid.data?.completions ?? []}
        keyExtractor={(c) => c.id}
        numColumns={3}
        contentContainerStyle={styles.list}
        columnWrapperStyle={styles.row}
        ListHeaderComponent={
          <View style={styles.header}>
            <Text style={styles.name}>{user?.displayName}</Text>
            <Text style={styles.handle}>@{user?.username}</Text>

            <View style={styles.stats}>
              <Stat value={me.data.streak.current} label="streak" />
              <Stat value={me.data.streak.longest} label="best" />
              <Stat value={me.data.stats.completions} label="quests" />
              <Stat value={me.data.stats.categoriesExplored} label="categories" />
            </View>

            <Pressable onPress={() => void signOut()} hitSlop={12}>
              <Text style={styles.signOut}>Sign out</Text>
            </Pressable>
          </View>
        }
        renderItem={({ item }) => (
          <Image source={{ uri: item.photoUrl }} style={styles.tile} resizeMode="cover" />
        )}
        ListEmptyComponent={
          <Empty title="No quests logged yet" hint="Complete one and it shows up here." />
        }
      />
    </SafeAreaView>
  );
}

function Stat({ value, label }: { value: number; label: string }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.bg },
  list: { padding: spacing(1), paddingBottom: spacing(6) },
  row: { gap: spacing(0.5), marginBottom: spacing(0.5) },
  header: { padding: spacing(2), gap: spacing(0.5) },
  name: { color: colors.text, fontSize: 26, fontWeight: '800' },
  handle: { color: colors.textMuted, marginBottom: spacing(1.5) },
  stats: { flexDirection: 'row', gap: spacing(3), marginBottom: spacing(2) },
  stat: { alignItems: 'flex-start' },
  statValue: { color: colors.text, fontSize: 20, fontWeight: '800' },
  statLabel: { color: colors.textMuted, fontSize: 12 },
  signOut: { color: colors.danger, fontWeight: '600' },
  tile: { flex: 1 / 3, aspectRatio: 1, borderRadius: radius.sm, backgroundColor: colors.surface },
});
