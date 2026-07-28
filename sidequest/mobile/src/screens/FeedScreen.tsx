import React, { useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api } from '../api/client';
import { CATEGORY_LABELS, type Category, type Quest } from '../api/types';
import { Empty, ErrorState, Loading } from '../components/States';
import { colors, radius, spacing } from '../theme/theme';

const CATEGORIES = Object.keys(CATEGORY_LABELS) as Category[];

export function FeedScreen() {
  const [category, setCategory] = useState<Category | null>(null);

  const streak = useQuery({ queryKey: ['streak'], queryFn: api.streak });
  const minis = useQuery({ queryKey: ['minis'], queryFn: api.minisToday });

  const feed = useInfiniteQuery({
    queryKey: ['quests', category],
    queryFn: ({ pageParam }) =>
      api.quests({ category: category ?? undefined, cursor: pageParam as string | undefined }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });

  const quests = feed.data?.pages.flatMap((p) => p.quests) ?? [];

  if (feed.isPending) return <Loading label="Finding quests near you" />;
  if (feed.isError) {
    return <ErrorState message={(feed.error as Error).message} onRetry={() => feed.refetch()} />;
  }

  return (
    <SafeAreaView style={styles.flex} edges={['top']}>
      <FlatList
        data={quests}
        keyExtractor={(q) => q.id}
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl
            refreshing={feed.isRefetching}
            onRefresh={() => {
              void feed.refetch();
              void streak.refetch();
              void minis.refetch();
            }}
            tintColor={colors.accent}
          />
        }
        onEndReachedThreshold={0.5}
        onEndReached={() => {
          if (feed.hasNextPage && !feed.isFetchingNextPage) void feed.fetchNextPage();
        }}
        ListHeaderComponent={
          <View style={styles.header}>
            <View style={styles.streakRow}>
              <Text style={styles.streakFlame}>{streak.data?.current ? '🔥' : '🕯️'}</Text>
              <View>
                <Text style={styles.streakCount}>
                  {streak.data?.current ?? 0} day{streak.data?.current === 1 ? '' : 's'}
                </Text>
                <Text style={styles.muted}>
                  {streak.data?.activeToday
                    ? "Today's done — anything else is a bonus"
                    : 'Log one thing today to keep it alive'}
                </Text>
              </View>
            </View>

            {minis.data && minis.data.minis.length > 0 ? (
              <View style={styles.minis}>
                <Text style={styles.sectionTitle}>
                  Today&apos;s minis · {minis.data.completed}/{minis.data.minis.length}
                </Text>
                {minis.data.minis.map((m) => (
                  <View key={m.assignmentId} style={styles.miniRow}>
                    <Text style={m.completedAt ? styles.miniDone : styles.miniTitle}>
                      {m.completedAt ? '✓ ' : '○ '}
                      {m.title}
                    </Text>
                  </View>
                ))}
              </View>
            ) : null}

            <View style={styles.chips}>
              <Chip label="All" active={category === null} onPress={() => setCategory(null)} />
              {CATEGORIES.map((c) => (
                <Chip
                  key={c}
                  label={CATEGORY_LABELS[c]}
                  active={category === c}
                  onPress={() => setCategory(category === c ? null : c)}
                />
              ))}
            </View>
          </View>
        }
        renderItem={({ item }) => <QuestCard quest={item} />}
        ListEmptyComponent={
          <Empty
            title="Nothing here yet"
            hint={
              category
                ? 'No quests in this category for your city. Try another filter.'
                : 'No quests seeded for your city yet.'
            }
          />
        }
      />
    </SafeAreaView>
  );
}

function Chip({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable onPress={onPress} style={[styles.chip, active && styles.chipActive]}>
      <Text style={[styles.chipText, active && styles.chipTextActive]}>{label}</Text>
    </Pressable>
  );
}

function QuestCard({ quest }: { quest: Quest }) {
  return (
    <View style={[styles.card, quest.completed && styles.cardDone]}>
      <View style={styles.cardTop}>
        <Text style={styles.cardCategory}>{CATEGORY_LABELS[quest.category]}</Text>
        {quest.completed ? <Text style={styles.done}>✓ Done</Text> : null}
      </View>
      <Text style={styles.cardTitle}>{quest.title}</Text>
      <Text style={styles.cardBody}>{quest.description}</Text>
      <Text style={styles.muted}>
        {quest.durationMin} min{quest.city ? ` · ${quest.city}` : ' · anywhere'}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.bg },
  list: { padding: spacing(2), gap: spacing(1.5), paddingBottom: spacing(6) },
  header: { gap: spacing(2), marginBottom: spacing(1) },
  streakRow: { flexDirection: 'row', alignItems: 'center', gap: spacing(1.5) },
  streakFlame: { fontSize: 34 },
  streakCount: { color: colors.text, fontSize: 24, fontWeight: '800' },
  muted: { color: colors.textMuted, fontSize: 13 },
  sectionTitle: { color: colors.text, fontWeight: '700', marginBottom: spacing(0.5) },
  minis: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing(2),
    borderWidth: 1,
    borderColor: colors.border,
  },
  miniRow: { paddingVertical: spacing(0.4) },
  miniTitle: { color: colors.text, fontSize: 14 },
  miniDone: { color: colors.success, fontSize: 14 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing(0.75) },
  chip: {
    borderRadius: 999,
    paddingHorizontal: spacing(1.5),
    paddingVertical: spacing(0.75),
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.border,
  },
  chipActive: { backgroundColor: colors.accentSoft, borderColor: colors.accent },
  chipText: { color: colors.textMuted, fontSize: 13, fontWeight: '600' },
  chipTextActive: { color: colors.accent },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing(2),
    borderWidth: 1,
    borderColor: colors.border,
    gap: spacing(0.5),
  },
  cardDone: { opacity: 0.55 },
  cardTop: { flexDirection: 'row', justifyContent: 'space-between' },
  cardCategory: { color: colors.accent, fontSize: 12, fontWeight: '700', letterSpacing: 0.4 },
  done: { color: colors.success, fontSize: 12, fontWeight: '700' },
  cardTitle: { color: colors.text, fontSize: 17, fontWeight: '700' },
  cardBody: { color: colors.textMuted, fontSize: 14, lineHeight: 20 },
});
