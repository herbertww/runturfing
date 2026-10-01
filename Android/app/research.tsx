import React, { useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Linking, Alert, LayoutAnimation,
  Platform, UIManager,
} from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { NEO, SPACING } from '../src/utils/theme';
import { FINDINGS, SOURCES, ResearchFinding, ResearchTier } from '../src/data/research';

// The intro sequence shows five of these findings and cannot link out, because
// opening a browser mid-onboarding drops people out of the flow. This screen is
// where the same evidence lives afterwards, with every citation live.

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

const TIER_LABEL: Record<ResearchTier, string> = {
  social: 'WHY THE GROUP WORKS',
  physiology: 'WHY IT MATTERS',
};

const TIER_ACCENT: Record<ResearchTier, string> = {
  social: NEO.violet,
  physiology: NEO.green,
};

async function open(url: string) {
  try {
    const ok = await Linking.canOpenURL(url);
    if (!ok) throw new Error('unsupported');
    await Linking.openURL(url);
  } catch {
    // A dead link should say so rather than doing nothing, which reads as a
    // broken tap target.
    Alert.alert('Could not open the source', url);
  }
}

function FindingCard({ finding }: { finding: ResearchFinding }) {
  const [open_, setOpen] = useState(false);
  const accent = TIER_ACCENT[finding.tier];

  return (
    <View style={styles.card}>
      <TouchableOpacity
        activeOpacity={0.85}
        onPress={() => {
          LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
          setOpen((v) => !v);
        }}
      >
        <View style={styles.cardHead}>
          <View style={[styles.statChip, { backgroundColor: accent }]}>
            <Text style={styles.statText}>
              {finding.stat}
              <Text style={styles.statSuffix}>{finding.statSuffix}</Text>
            </Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.eyebrow}>{finding.eyebrow}</Text>
            <Text style={styles.headline}>{finding.headline}</Text>
          </View>
          <Ionicons
            name={open_ ? 'chevron-up' : 'chevron-down'}
            size={18}
            color={NEO.ink}
          />
        </View>
      </TouchableOpacity>

      <Text style={styles.body}>{finding.body}</Text>

      {open_ && finding.detail ? (
        <Text style={[styles.body, styles.detail]}>{finding.detail}</Text>
      ) : null}

      {open_ && finding.caveat ? (
        <View style={styles.caveat}>
          <Ionicons name="alert-circle-outline" size={14} color={NEO.ink} />
          <Text style={styles.caveatText}>{finding.caveat}</Text>
        </View>
      ) : null}

      {finding.url && finding.source ? (
        <TouchableOpacity
          style={styles.sourceTag}
          onPress={() => open(finding.url as string)}
          accessibilityRole="link"
          accessibilityLabel={`Open the source: ${finding.source}`}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Ionicons name="document-text" size={13} color={NEO.ink} />
          <Text style={styles.sourceText}>{finding.source}</Text>
          <Ionicons name="open-outline" size={13} color={NEO.ink} />
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

export default function ResearchScreen() {
  const social = FINDINGS.filter((f) => f.tier === 'social');
  const physiology = FINDINGS.filter((f) => f.tier === 'physiology');

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.topBar}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => router.back()}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        >
          <Ionicons name="arrow-back" size={20} color={NEO.ink} />
        </TouchableOpacity>
        <View style={styles.titleBlock}>
          <Text style={styles.title}>INTERIOR RESEARCH</Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Text style={styles.lede}>
          Extant research findings govern the design of Runturfing, helping you
          sustain exercise motivation over time:
        </Text>

        {[
          { tier: 'social' as const, items: social },
          { tier: 'physiology' as const, items: physiology },
        ].map(({ tier, items }) => (
          <View key={tier}>
            <View style={[styles.sectionChip, { backgroundColor: TIER_ACCENT[tier] }]}>
              <Text style={styles.sectionChipText}>{TIER_LABEL[tier]}</Text>
            </View>
            {items.map((f) => (
              <FindingCard key={f.key} finding={f} />
            ))}
          </View>
        ))}

        <View style={[styles.sectionChip, { backgroundColor: NEO.ink }]}>
          <Text style={styles.sectionChipText}>EVERY SOURCE</Text>
        </View>

        <View style={styles.sourceList}>
          {SOURCES.map((s) => (
            <TouchableOpacity
              key={s.url}
              style={styles.sourceRow}
              onPress={() => open(s.url)}
              accessibilityRole="link"
              accessibilityLabel={`Open ${s.label}`}
            >
              <View style={{ flex: 1 }}>
                <Text style={styles.sourceLabel}>{s.label}</Text>
                <Text style={styles.sourceCite}>{s.cite}</Text>
              </View>
              <Ionicons name="open-outline" size={16} color={NEO.ink} />
            </TouchableOpacity>
          ))}
        </View>

        <Text style={styles.footnote}>
          These are population-level findings. They describe what happened across
          groups of people in the studies named, and none of them is a prediction
          about any one runner or a substitute for medical advice.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: NEO.surface },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.md,
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.sm,
  },
  backButton: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: NEO.ink,
    backgroundColor: NEO.white,
    ...NEO.shadow(),
  },
  titleBlock: { backgroundColor: NEO.ink, paddingHorizontal: 10, paddingVertical: 6 },
  title: { fontSize: 14, fontWeight: '900', color: NEO.surface, letterSpacing: 2 },
  content: { padding: SPACING.lg, paddingBottom: SPACING.xxl },
  lede: { fontSize: 15, color: NEO.ink, lineHeight: 23, marginBottom: SPACING.lg },
  sectionChip: {
    alignSelf: 'flex-start',
    paddingHorizontal: 10,
    paddingVertical: 5,
    marginBottom: SPACING.md,
    marginTop: SPACING.sm,
    borderWidth: 2,
    borderColor: NEO.ink,
  },
  sectionChipText: { fontSize: 11, fontWeight: '900', letterSpacing: 1.5, color: NEO.white },
  card: {
    backgroundColor: NEO.white,
    borderWidth: NEO.borderWidth,
    borderColor: NEO.ink,
    padding: SPACING.md,
    marginBottom: SPACING.md,
    ...NEO.shadow(),
  },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm },
  statChip: {
    borderWidth: 2,
    borderColor: NEO.ink,
    paddingHorizontal: SPACING.sm,
    paddingVertical: 6,
    minWidth: 62,
    alignItems: 'center',
  },
  statText: { fontSize: 22, fontWeight: '900', color: NEO.white, letterSpacing: -0.5 },
  statSuffix: { fontSize: 11, fontWeight: '800' },
  eyebrow: { fontSize: 10, fontWeight: '800', letterSpacing: 1.2, color: NEO.ink, opacity: 0.65 },
  headline: { fontSize: 17, fontWeight: '900', color: NEO.ink, marginTop: 2, lineHeight: 22 },
  body: { fontSize: 14, color: NEO.ink, lineHeight: 21, marginTop: SPACING.sm },
  detail: { opacity: 0.85 },
  caveat: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
    marginTop: SPACING.sm,
    backgroundColor: NEO.surfaceAlt,
    borderWidth: 2,
    borderColor: NEO.ink,
    padding: SPACING.sm,
  },
  caveatText: { flex: 1, fontSize: 12, color: NEO.ink, lineHeight: 17 },
  sourceTag: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: SPACING.md,
    borderWidth: 2,
    borderColor: NEO.ink,
    backgroundColor: NEO.yellow,
    paddingHorizontal: 8,
    paddingVertical: 5,
  },
  sourceText: { fontSize: 12, fontWeight: '700', color: NEO.ink },
  sourceList: {
    borderWidth: NEO.borderWidth,
    borderColor: NEO.ink,
    backgroundColor: NEO.white,
    ...NEO.shadow(),
  },
  sourceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    padding: SPACING.md,
    borderBottomWidth: 2,
    borderBottomColor: NEO.surfaceAlt,
  },
  sourceLabel: { fontSize: 14, fontWeight: '700', color: NEO.ink },
  sourceCite: { fontSize: 12, color: NEO.ink, opacity: 0.65, marginTop: 2 },
  footnote: {
    fontSize: 12,
    color: NEO.ink,
    opacity: 0.6,
    lineHeight: 18,
    marginTop: SPACING.lg,
  },
});
