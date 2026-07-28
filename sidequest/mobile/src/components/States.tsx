import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, radius, spacing } from '../theme/theme';

export function Loading({ label }: { label?: string }) {
  return (
    <View style={styles.center}>
      <ActivityIndicator color={colors.accent} />
      {label ? <Text style={styles.muted}>{label}</Text> : null}
    </View>
  );
}

/**
 * One error component for every screen, always with a retry.
 *
 * A dead-end error message is the fastest way to lose a tester — they cannot
 * tell "the server is down" from "the app is broken" without a way to try again.
 */
export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <View style={styles.center}>
      <Text style={styles.errorTitle}>Something went wrong</Text>
      <Text style={styles.muted}>{message}</Text>
      {onRetry ? (
        <Pressable style={styles.retry} onPress={onRetry}>
          <Text style={styles.retryText}>Try again</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

export function Empty({ title, hint }: { title: string; hint?: string }) {
  return (
    <View style={styles.center}>
      <Text style={styles.emptyTitle}>{title}</Text>
      {hint ? <Text style={styles.muted}>{hint}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing(3),
    gap: spacing(1),
  },
  muted: { color: colors.textMuted, textAlign: 'center', fontSize: 14, lineHeight: 20 },
  errorTitle: { color: colors.text, fontSize: 17, fontWeight: '600' },
  emptyTitle: { color: colors.text, fontSize: 17, fontWeight: '600' },
  retry: {
    marginTop: spacing(1),
    backgroundColor: colors.accent,
    paddingHorizontal: spacing(2.5),
    paddingVertical: spacing(1.25),
    borderRadius: radius.sm,
  },
  retryText: { color: '#fff', fontWeight: '600' },
});
