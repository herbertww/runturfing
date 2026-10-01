import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { showMessage } from 'react-native-flash-message';
import { institutionsApi } from '../src/services/apiClient';
import InstitutionPicker from '../src/components/InstitutionPicker';
import { NEO, SPACING } from '../src/utils/theme';

/**
 * Set or change the school you run for.
 *
 * The pick freezes once the orientation season goes active. The server is the
 * one enforcing that; this screen mirrors it so the button is not offered and
 * then refused, which reads as a bug rather than a rule.
 */
export default function SchoolScreen() {
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['institution-me'],
    queryFn: () => institutionsApi.getMine().then((r) => r.data),
  });

  // Seed the selection from the server once, without stomping on a choice the
  // user has already made while the request was in flight.
  useEffect(() => {
    if (data?.institution && selected === null) setSelected(data.institution.slug);
  }, [data?.institution?.slug]);

  const locked = data?.locked ?? false;
  const current = data?.institution ?? null;
  const dirty = selected !== (current?.slug ?? null);

  const save = async () => {
    setSaving(true);
    try {
      await institutionsApi.setMine(selected);
      queryClient.invalidateQueries({ queryKey: ['institution-me'] });
      queryClient.invalidateQueries({ queryKey: ['institution-standings'] });
      showMessage({
        message: selected ? 'School set.' : 'School cleared.',
        type: 'success',
      });
      router.back();
    } catch (e: any) {
      showMessage({
        message: e?.response?.data?.detail ?? 'Could not save your school.',
        type: 'danger',
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} onPress={() => router.back()} hitSlop={8}>
          <Ionicons name="arrow-back" size={22} color={NEO.ink} />
        </TouchableOpacity>
        <Text style={styles.title}>YOUR SCHOOL</Text>
      </View>

      {locked && (
        <View style={styles.lockedBanner}>
          <Ionicons name="lock-closed" size={16} color={NEO.ink} />
          <Text style={styles.lockedText}>
            Locked until the season ends. Ground you take under one crest stays
            with that crest.
          </Text>
        </View>
      )}

      <View style={styles.body}>
        {isLoading ? (
          <ActivityIndicator color={NEO.violet} style={{ marginTop: SPACING.xl }} />
        ) : (
          <InstitutionPicker value={selected} onChange={setSelected} locked={locked} />
        )}
      </View>

      {!locked && (
        <TouchableOpacity
          style={[styles.saveButton, !dirty && styles.saveButtonDisabled]}
          disabled={!dirty || saving}
          onPress={save}
        >
          <Text style={styles.saveText}>
            {saving ? 'SAVING…' : selected ? 'SAVE' : 'RUN FOR NO SCHOOL'}
          </Text>
        </TouchableOpacity>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: NEO.surface },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.md,
    padding: SPACING.lg,
    paddingBottom: SPACING.md,
  },
  backButton: {
    width: 40, height: 40, alignItems: 'center', justifyContent: 'center',
    borderWidth: 2, borderColor: NEO.ink, backgroundColor: NEO.white, ...NEO.shadow(),
  },
  title: { fontSize: 22, fontWeight: '900', color: NEO.ink, letterSpacing: 0.5 },
  lockedBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    marginHorizontal: SPACING.lg,
    marginBottom: SPACING.md,
    padding: SPACING.sm,
    borderWidth: 2,
    borderColor: NEO.ink,
    backgroundColor: NEO.yellow,
  },
  lockedText: { flex: 1, fontSize: 12, fontWeight: '600', color: NEO.ink, lineHeight: 17 },
  body: { flex: 1, paddingHorizontal: SPACING.lg },
  saveButton: {
    margin: SPACING.lg,
    backgroundColor: NEO.yellow,
    borderWidth: NEO.borderWidth,
    borderColor: NEO.ink,
    paddingVertical: 16,
    alignItems: 'center',
    ...NEO.shadowLg(),
  },
  saveButtonDisabled: { backgroundColor: NEO.surfaceAlt, boxShadow: 'none' },
  saveText: { fontSize: 15, fontWeight: '900', color: NEO.ink, letterSpacing: 1 },
});
