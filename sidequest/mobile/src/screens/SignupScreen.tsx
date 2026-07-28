import React, { useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useAuth } from '../auth/AuthContext';
import { authStyles as styles } from './LoginScreen';
import { colors } from '../theme/theme';

export function SignupScreen({ onSwitch }: { onSwitch: () => void }) {
  const { signUp } = useAuth();
  const [form, setForm] = useState({
    displayName: '',
    username: '',
    email: '',
    password: '',
    city: '',
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const set = (key: keyof typeof form) => (value: string) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const submit = async () => {
    setError(null);

    // Checked here as well as on the server so the failure is instant rather
    // than a round trip.
    if (form.password.length < 8) {
      setError('Password must be at least 8 characters');
      return;
    }
    if (form.username.length < 3) {
      setError('Username must be at least 3 characters');
      return;
    }

    setBusy(true);
    try {
      await signUp({
        email: form.email.trim(),
        username: form.username.trim(),
        password: form.password,
        displayName: form.displayName.trim(),
        city: form.city.trim(),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create your account');
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <Text style={styles.logo}>Create account</Text>
        <Text style={styles.tagline}>Takes about twenty seconds.</Text>

        <TextInput
          style={styles.input}
          placeholder="Your name"
          placeholderTextColor={colors.textMuted}
          value={form.displayName}
          onChangeText={set('displayName')}
        />
        <TextInput
          style={styles.input}
          placeholder="Username"
          placeholderTextColor={colors.textMuted}
          autoCapitalize="none"
          value={form.username}
          onChangeText={set('username')}
        />
        <TextInput
          style={styles.input}
          placeholder="Email"
          placeholderTextColor={colors.textMuted}
          autoCapitalize="none"
          keyboardType="email-address"
          value={form.email}
          onChangeText={set('email')}
        />
        <TextInput
          style={styles.input}
          placeholder="Password (8+ characters)"
          placeholderTextColor={colors.textMuted}
          secureTextEntry
          value={form.password}
          onChangeText={set('password')}
        />
        <TextInput
          style={styles.input}
          placeholder="City (optional)"
          placeholderTextColor={colors.textMuted}
          value={form.city}
          onChangeText={set('city')}
          onSubmitEditing={submit}
        />

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <Pressable
          style={[styles.button, busy && styles.buttonDisabled]}
          onPress={submit}
          disabled={busy}
        >
          <Text style={styles.buttonText}>{busy ? 'Creating…' : 'Create account'}</Text>
        </Pressable>

        <Pressable onPress={onSwitch} hitSlop={12}>
          <Text style={styles.link}>Already have an account? Sign in</Text>
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
