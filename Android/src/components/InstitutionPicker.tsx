import React, { useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, TextInput, TouchableOpacity,
  ActivityIndicator, SectionList,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { institutionsApi } from '../services/apiClient';
import { Institution, InstitutionKind } from '../types';
import { NEO, SPACING } from '../utils/theme';

const KIND_LABEL: Record<InstitutionKind, string> = {
  university: 'Universities',
  polytechnic: 'Polytechnics',
  ite: 'ITE',
  arts: 'Arts institutions',
};

const KIND_ORDER: InstitutionKind[] = ['university', 'polytechnic', 'ite', 'arts'];

type Props = {
  value: string | null;
  onChange: (slug: string | null) => void;
  /** Set once a season starts. The list still renders, greyed and inert. */
  locked?: boolean;
  /** Onboarding shows this; the profile screen does not need it. */
  showSkip?: boolean;
  onSkip?: () => void;
};

/**
 * Searchable school list, grouped by institution type.
 *
 * Search matches the short name as well as the full one because nobody types
 * "Nanyang Technological University" — they type NTU. Grouping by type is what
 * stops a polytechnic student scrolling past six universities to reach their
 * own school, and it makes the four-way split of the standings table legible
 * before the season starts.
 */
export default function InstitutionPicker({
  value, onChange, locked = false, showSkip = false, onSkip,
}: Props) {
  const [query, setQuery] = useState('');

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['institutions'],
    queryFn: () => institutionsApi.list().then((r) => r.data),
    // The list changes when a school is added, which is roughly never.
    staleTime: 24 * 60 * 60 * 1000,
  });

  const sections = useMemo(() => {
    const q = query.trim().toLowerCase();
    const match = (i: Institution) =>
      !q ||
      i.name.toLowerCase().includes(q) ||
      i.shortName.toLowerCase().includes(q) ||
      i.slug.includes(q);

    return KIND_ORDER.map((kind) => ({
      kind,
      title: KIND_LABEL[kind],
      data: (data ?? []).filter((i) => i.kind === kind && match(i)),
    })).filter((s) => s.data.length > 0);
  }, [data, query]);

  if (isLoading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color={NEO.violet} />
      </View>
    );
  }

  if (isError) {
    return (
      <View style={styles.centered}>
        <Text style={styles.errorText}>Could not load the school list.</Text>
        <TouchableOpacity style={styles.retryButton} onPress={() => refetch()}>
          <Text style={styles.retryText}>RETRY</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={{ flex: 1 }}>
      <View style={styles.searchRow}>
        <Ionicons name="search" size={18} color={NEO.ink} />
        <TextInput
          style={styles.searchInput}
          value={query}
          onChangeText={setQuery}
          placeholder="Search NUS, SP, LASALLE…"
          placeholderTextColor={NEO.ink + '55'}
          autoCorrect={false}
          editable={!locked}
        />
        {query.length > 0 && (
          <TouchableOpacity onPress={() => setQuery('')} hitSlop={8}>
            <Ionicons name="close-circle" size={18} color={NEO.ink} />
          </TouchableOpacity>
        )}
      </View>

      <SectionList
        sections={sections}
        keyExtractor={(item) => item.slug}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingBottom: SPACING.xl }}
        renderSectionHeader={({ section }) => (
          <Text style={styles.sectionHeader}>{section.title.toUpperCase()}</Text>
        )}
        renderItem={({ item }) => {
          const selected = item.slug === value;
          return (
            <TouchableOpacity
              style={[
                styles.row,
                selected && styles.rowSelected,
                locked && styles.rowLocked,
              ]}
              disabled={locked}
              activeOpacity={0.85}
              onPress={() => onChange(selected ? null : item.slug)}
            >
              <View style={[styles.crest, { backgroundColor: item.color }]}>
                <Text style={styles.crestText}>{item.shortName.slice(0, 4)}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.rowName}>{item.shortName}</Text>
                <Text style={styles.rowFull} numberOfLines={1}>{item.name}</Text>
              </View>
              {selected && (
                <Ionicons name="checkmark-circle" size={22} color={NEO.green} />
              )}
            </TouchableOpacity>
          );
        }}
        ListEmptyComponent={
          <Text style={styles.emptyText}>No school matches “{query}”.</Text>
        }
      />

      {showSkip && !locked && (
        <TouchableOpacity style={styles.skip} onPress={onSkip}>
          <Text style={styles.skipText}>I'm not a student</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  centered: { padding: SPACING.xl, alignItems: 'center', gap: SPACING.md },
  errorText: { fontSize: 14, color: NEO.ink, opacity: 0.75 },
  retryButton: {
    borderWidth: 2, borderColor: NEO.ink, backgroundColor: NEO.yellow,
    paddingHorizontal: 20, paddingVertical: 10, ...NEO.shadow(),
  },
  retryText: { fontSize: 13, fontWeight: '900', color: NEO.ink, letterSpacing: 1 },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    borderWidth: NEO.borderWidth,
    borderColor: NEO.ink,
    backgroundColor: NEO.white,
    paddingHorizontal: SPACING.md,
    paddingVertical: 10,
    marginBottom: SPACING.md,
  },
  searchInput: { flex: 1, fontSize: 16, fontWeight: '600', color: NEO.ink, padding: 0 },
  sectionHeader: {
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 1.4,
    color: NEO.ink,
    opacity: 0.55,
    marginTop: SPACING.md,
    marginBottom: SPACING.xs,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.md,
    borderWidth: 2,
    borderColor: NEO.ink,
    backgroundColor: NEO.white,
    padding: SPACING.sm,
    marginBottom: SPACING.sm,
  },
  rowSelected: { backgroundColor: NEO.yellow, ...NEO.shadow() },
  rowLocked: { opacity: 0.5 },
  crest: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: NEO.ink,
  },
  // Short names run to seven characters (LASALLE), so the crest text is sized
  // to the longest one rather than to NUS.
  crestText: { fontSize: 11, fontWeight: '900', color: NEO.white, letterSpacing: 0.3 },
  rowName: { fontSize: 16, fontWeight: '800', color: NEO.ink },
  rowFull: { fontSize: 12, color: NEO.ink, opacity: 0.6 },
  emptyText: {
    fontSize: 14, color: NEO.ink, opacity: 0.6,
    textAlign: 'center', paddingVertical: SPACING.xl,
  },
  skip: { alignItems: 'center', padding: SPACING.md },
  skipText: { fontSize: 15, fontWeight: '600', color: NEO.ink, opacity: 0.7 },
});
