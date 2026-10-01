import React, { useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  Image, ActivityIndicator, Switch, Alert, TextInput, Linking,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { showMessage } from 'react-native-flash-message';
import { profileApi, institutionsApi } from '../../src/services/apiClient';
import { useAuthStore } from '../../src/stores/authStore';
import { Influence, Rank, Run, SocialAccount, TerritoryHistoryEntry } from '../../src/types';
import { COLORS, SPACING, RADIUS, SHADOWS } from '../../src/utils/theme';
import RankInsignia from '../../src/components/RankInsignia';
import { useTerritoryStore } from '../../src/stores/territoryStore';
import { demoProfile } from '../../src/utils/demoTerritory';
import { demoProfileExtras, demoMyInstitution } from '../../src/utils/demoData';

const SOCIAL_ICONS: Record<string, { icon: string; color: string }> = {
  instagram: { icon: 'logo-instagram', color: '#E1306C' },
  tiktok: { icon: 'logo-tiktok', color: '#ffffff' },
  twitter: { icon: 'logo-twitter', color: '#1DA1F2' },
  strava: { icon: 'bicycle-outline', color: '#FC4C02' },
};

function StatCard({ value, label, color }: { value: string | number; label: string; color?: string }) {
  return (
    <View style={styles.statCard}>
      <Text style={[styles.statValue, color ? { color } : {}]}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

function RunRow({ run }: { run: Run }) {
  const date = new Date(run.startedAt);
  const km = (run.distanceMeters / 1000).toFixed(2);
  const mins = Math.floor(run.durationSeconds / 60);
  const pace = run.distanceMeters > 0
    ? (run.durationSeconds / 60 / (run.distanceMeters / 1000)).toFixed(1)
    : '—';

  return (
    <View style={styles.runRow}>
      <View style={styles.runDate}>
        <Text style={styles.runDateDay}>{date.getDate()}</Text>
        <Text style={styles.runDateMonth}>
          {date.toLocaleString('default', { month: 'short' })}
        </Text>
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.runDistance}>{km} km</Text>
        <Text style={styles.runMeta}>{mins} min · {pace} min/km</Text>
      </View>
      <View style={{ alignItems: 'flex-end' }}>
        <Text style={styles.runCells}>+{run.newCellsClaimed} cells</Text>
        {run.cellsDefended > 0 && (
          <Text style={[styles.runCells, { color: COLORS.success }]}>
            {run.cellsDefended} defended
          </Text>
        )}
      </View>
    </View>
  );
}

/**
 * The rank card. A runner sits on one track only: clearing the officer gate
 * (distance and pace together) moves them onto the commissioned ladder, which
 * is the one that reaches the stars. Everyone else progresses on the specialist
 * and warrant ladder, earned purely by turning up. The card says which one is
 * in play and what the other one would take, because a Master Sergeant who does
 * not know the officer gate exists reads their rank as a ceiling.
 */
function RankCard({ rank }: { rank: Rank }) {
  const officer = rank.track === 'officer';
  return (
    <View style={styles.section}>
      <View style={styles.rankHead}>
        <RankInsignia code={rank.code} track={rank.track} stars={rank.stars} size="lg" />
        <View style={{ flex: 1 }}>
          <Text style={styles.rankName}>{rank.name}</Text>
          <Text style={styles.rankTrack}>
            {officer ? 'Commissioned track' : 'Specialist / warrant track'}
          </Text>
        </View>
      </View>

      <View style={styles.rankBarTrack}>
        <View
          style={[
            styles.rankBarFill,
            {
              width: `${Math.round(rank.progress * 100)}%`,
              backgroundColor: officer ? COLORS.warning : COLORS.primary,
            },
          ]}
        />
      </View>

      <Text style={styles.rankProgress}>
        {rank.nextName
          ? `${Math.round(rank.points)} pts · ${Math.round(rank.pointsToNext ?? 0)} to ${rank.nextName}`
          : `${Math.round(rank.points)} pts · top of the ladder`}
      </Text>

      <Text style={styles.rankHint}>
        {officer
          ? 'Distance and pace compound here. Slowing down without adding distance stalls the ladder, and dropping below the gate returns you to the warrant track.'
          : 'This ladder is earned by turning up: active days, streaks, and weeks that held three runs. Clear 50 km at 8 km/h or better and you move to the commissioned track instead.'}
      </Text>
    </View>
  );
}

/**
 * Cell ownership is winner-takes-all, so a runner who is narrowly second across
 * a whole neighbourhood shows as holding nothing. Influence counts every cell
 * they have a live score in, and the 30-day average is what the leaderboard
 * sorts on — one strong week should not settle it.
 */
function InfluenceCard({ influence }: { influence: Influence }) {
  const series = influence.series ?? [];
  const peak = Math.max(1, ...series.map((s) => s.cells));

  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>Influence</Text>
      <View style={styles.influenceRow}>
        <View style={styles.influenceItem}>
          <Text style={[styles.influenceValue, { color: COLORS.primary }]}>
            {influence.movingAverage30.toFixed(1)}
          </Text>
          <Text style={styles.influenceLabel}>30-day avg</Text>
        </View>
        <View style={styles.influenceItem}>
          <Text style={styles.influenceValue}>{influence.movingAverage7.toFixed(1)}</Text>
          <Text style={styles.influenceLabel}>7-day avg</Text>
        </View>
        <View style={styles.influenceItem}>
          <Text style={styles.influenceValue}>{influence.cellsNow}</Text>
          <Text style={styles.influenceLabel}>Cells today</Text>
        </View>
        <View style={styles.influenceItem}>
          <Text style={[styles.influenceValue, { color: COLORS.claimed }]}>
            {influence.cellsLed}
          </Text>
          <Text style={styles.influenceLabel}>Cells led</Text>
        </View>
      </View>

      {series.length > 1 && (
        <View style={styles.spark}>
          {series.map((s) => (
            <View
              key={s.date}
              style={[
                styles.sparkBar,
                { height: Math.max(2, (s.cells / peak) * 40) },
              ]}
            />
          ))}
        </View>
      )}

      <Text style={styles.influenceHint}>
        Cells you score in, whether or not you lead them. Leading is
        winner-takes-all; this is the number that credits ground you nearly took.
      </Text>
    </View>
  );
}

/**
 * The school crest, or an invitation to pick one.
 *
 * Renders in both states rather than hiding when unset: a blank space tells a
 * student nothing, and the orientation season depends on people finding this
 * row after they skipped it during onboarding.
 */
function SchoolRow() {
  const { demoMode } = useTerritoryStore();
  const { data: fetched } = useQuery({
    queryKey: ['institution-me'],
    queryFn: () => institutionsApi.getMine().then((r) => r.data),
    staleTime: 60_000,
    enabled: !demoMode,
  });
  const data = demoMode ? demoMyInstitution() : fetched;

  const school = data?.institution ?? null;

  return (
    <TouchableOpacity
      style={styles.researchCard}
      onPress={() => router.push('/school')}
      activeOpacity={0.85}
    >
      {school ? (
        <View style={[styles.schoolCrest, { backgroundColor: school.color }]}>
          <Text style={styles.schoolCrestText}>{school.shortName.slice(0, 4)}</Text>
        </View>
      ) : (
        <Ionicons name="school-outline" size={22} color={COLORS.textPrimary} />
      )}
      <View style={{ flex: 1 }}>
        <Text style={styles.researchTitle}>
          {school ? school.shortName : 'Pick your school'}
        </Text>
        <Text style={styles.researchSub}>
          {school
            ? data?.contribution
              ? `${data.contribution.turfCells} cells held for ${school.shortName}`
              : school.name
            : 'Your turf counts for the school you run under'}
        </Text>
      </View>
      {data?.locked ? (
        <Ionicons name="lock-closed" size={16} color={COLORS.textMuted} />
      ) : (
        <Ionicons name="chevron-forward" size={18} color={COLORS.textPrimary} />
      )}
    </TouchableOpacity>
  );
}

export default function ProfileScreen() {
  const { user, logout } = useAuthStore();
  const { cells, demoMode } = useTerritoryStore();
  const queryClient = useQueryClient();
  const [platform, setPlatform] = useState<'instagram' | 'tiktok'>('instagram');
  const [handle, setHandle] = useState('');
  const [linking, setLinking] = useState(false);
  const [locationFuzz, setLocationFuzz] = useState(true);
  const [publicProfile, setPublicProfile] = useState(true);

  const { data: profile, isLoading, isError, refetch } = useQuery({
    queryKey: ['profile-me'],
    queryFn: () => profileApi.getMe().then((r) => r.data),
    staleTime: 60_000,
  });

  // Rank and influence already fall back to demo data below; stats, recent
  // runs and socials did not, so a demo session showed a real (failing)
  // profile fetch's empty state under a fabricated rank. `cells` keeps
  // "Cells Owned" in step with whatever the demo territory actually holds.
  const demoExtras = demoMode ? demoProfileExtras(cells) : null;

  // Optional chaining only guards `profile`. Reading `.length` straight off
  // `profile.recentRuns` threw whenever the payload arrived without the field,
  // which silently swallowed the whole section instead of showing its empty
  // state. Defaulting here means the empty state is the empty state.
  const recentRuns = demoExtras?.recentRuns ?? profile?.recentRuns ?? [];
  const socialAccounts = demoExtras?.socialAccounts ?? profile?.socialAccounts ?? [];

  const linkSocial = async () => {
    const clean = handle.trim().replace(/^@/, '');
    if (!clean) return;
    setLinking(true);
    try {
      await profileApi.linkSocial(platform, clean);
      setHandle('');
      queryClient.invalidateQueries({ queryKey: ['profile-me'] });
      showMessage({ message: `Linked @${clean}`, type: 'success' });
    } catch (e: any) {
      showMessage({
        message: e?.response?.data?.detail ?? 'Could not link that account.',
        type: 'danger',
      });
    } finally {
      setLinking(false);
    }
  };

  const openSocial = (p: string, h: string) => {
    const url =
      p === 'instagram' ? `https://instagram.com/${h}`
      : p === 'tiktok' ? `https://tiktok.com/@${h}`
      : p === 'twitter' ? `https://x.com/${h}`
      : `https://strava.com/athletes/${h}`;
    Linking.openURL(url).catch(() => {});
  };

  const handleLogout = () => {
    Alert.alert('Sign Out', 'Are you sure you want to sign out?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign Out',
        style: 'destructive',
        onPress: async () => {
          await logout();
          router.replace('/(auth)/onboarding');
        },
      },
    ]);
  };

  if (isLoading && !demoMode) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <View style={styles.loader}>
          <ActivityIndicator size="large" color={COLORS.primary} />
        </View>
      </SafeAreaView>
    );
  }

  // A failed profile fetch used to render as an account with no runs, no stats
  // and no socials, which is indistinguishable from a new account.
  if (isError && !demoMode) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <View style={styles.loader}>
          <Text style={styles.emptyText}>Could not load your profile.</Text>
          <TouchableOpacity style={styles.addSocialButton} onPress={() => refetch()}>
            <Ionicons name="refresh" size={18} color={COLORS.primary} />
            <Text style={styles.addSocialText}>Try again</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  const stats = demoExtras?.stats ?? profile?.stats;
  const displayName = profile?.user.displayName ?? user?.displayName ?? 'Runner';
  // With the demo city on, the profile shows its rank and influence instead of
  // waiting on a backend that has neither deployed yet.
  const demo = demoMode ? demoProfile(cells) : null;
  const rank = demo?.rank ?? profile?.rank;
  const influence = demo?.influence ?? profile?.influence;
  const city = profile?.user.city ?? 'Unknown City';

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScrollView contentContainerStyle={styles.content}>
        {/* Header */}
        <View style={styles.profileHeader}>
          <View style={styles.avatarLarge}>
            {profile?.user.avatarUrl ? (
              <Image source={{ uri: profile.user.avatarUrl }} style={styles.avatarLargeImage} />
            ) : (
              <View style={styles.avatarLargePlaceholder}>
                <Text style={styles.avatarLargeInitial}>
                  {displayName.charAt(0).toUpperCase()}
                </Text>
              </View>
            )}
          </View>
          <Text style={styles.displayName}>{displayName}</Text>
          {rank && (
            <View style={{ marginTop: SPACING.xs }}>
              <RankInsignia
                code={rank.code}
                track={rank.track}
                stars={rank.stars}
              />
            </View>
          )}
          <Text style={styles.cityText}>{city}</Text>
          {profile?.user.isVerified && (
            <View style={styles.verifiedBadge}>
              <Ionicons name="checkmark-circle" size={14} color={COLORS.primary} />
              <Text style={styles.verifiedText}>Verified</Text>
            </View>
          )}
        </View>

        {/* Stats grid */}
        {stats && (
          <View style={styles.statsGrid}>
            <StatCard value={stats.totalRuns} label="Total Runs" />
            <StatCard value={`${(stats.totalKm).toFixed(0)} km`} label="Total Distance" color={COLORS.primary} />
            <StatCard value={stats.totalCells} label="Cells Owned" color={COLORS.claimed} />
            <StatCard value={`${stats.currentStreak}d`} label="Streak" color={COLORS.success} />
            <StatCard value={stats.seasonsCompleted} label="Seasons" />
            <StatCard value={stats.longestStreak} label="Best Streak" />
          </View>
        )}

        {/* Rank and influence */}
        {rank && <RankCard rank={rank} />}
        {influence && <InfluenceCard influence={influence} />}

        {/* The school you run for. Sits above the reading room because during
            the orientation season it is the thing people check on themselves. */}
        <SchoolRow />

        {/* The reading room. Not a tab: it is somewhere you go into, not a
            destination competing with the map. */}
        <TouchableOpacity
          style={styles.researchCard}
          onPress={() => router.push('/research')}
          activeOpacity={0.85}
        >
          <Ionicons name="library-outline" size={22} color={COLORS.textPrimary} />
          <View style={{ flex: 1 }}>
            <Text style={styles.researchTitle}>Interior Research</Text>
            <Text style={styles.researchSub}>
              Read about why covering miles daily is so important
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={COLORS.textPrimary} />
        </TouchableOpacity>

        {/* Social accounts */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Social Accounts</Text>
          {socialAccounts.length === 0 ? (
            <Text style={styles.emptyText}>No social accounts linked yet.</Text>
          ) : (
            socialAccounts.map((acc) => {
              const cfg = SOCIAL_ICONS[acc.platform] ?? { icon: 'link-outline', color: COLORS.textSecondary };
              return (
                <View key={acc.platform} style={styles.socialRow}>
                  <Ionicons name={cfg.icon as any} size={20} color={cfg.color} />
                  <TouchableOpacity onPress={() => openSocial(acc.platform, acc.handle)}>
                    <Text style={[styles.socialHandle, styles.socialHandleLink]}>@{acc.handle}</Text>
                  </TouchableOpacity>
                  {acc.verified && (
                    <Ionicons name="checkmark-circle" size={14} color={COLORS.success} />
                  )}
                  <TouchableOpacity
                    style={styles.unlinkButton}
                    onPress={async () => {
                      await profileApi.unlinkSocial(acc.platform);
                      queryClient.invalidateQueries({ queryKey: ['profile-me'] });
                    }}
                  >
                    <Text style={styles.unlinkText}>Unlink</Text>
                  </TouchableOpacity>
                </View>
              );
            })
          )}
          <View style={styles.linkRow}>
            <View style={styles.platformPicker}>
              {(['instagram', 'tiktok'] as const).map((p) => (
                <TouchableOpacity
                  key={p}
                  style={[styles.platformChip, platform === p && styles.platformChipActive]}
                  onPress={() => setPlatform(p)}
                >
                  <Ionicons
                    name={SOCIAL_ICONS[p].icon as any}
                    size={16}
                    color={platform === p ? COLORS.textPrimary : COLORS.textMuted}
                  />
                </TouchableOpacity>
              ))}
            </View>
            <TextInput
              style={styles.handleInput}
              value={handle}
              onChangeText={setHandle}
              placeholder="your handle"
              placeholderTextColor={COLORS.textMuted}
              autoCapitalize="none"
              autoCorrect={false}
            />
            <TouchableOpacity style={styles.linkButton} onPress={linkSocial} disabled={linking}>
              {linking ? (
                <ActivityIndicator size="small" color={COLORS.textPrimary} />
              ) : (
                <Text style={styles.linkButtonText}>LINK</Text>
              )}
            </TouchableOpacity>
          </View>
          <Text style={styles.linkHint}>
            A handle lets people find you. Proving you own it earns a small
            capture bonus, and needs signing in through the platform.
          </Text>
        </View>

        {/* Recent runs */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Recent Runs</Text>
          {recentRuns.length === 0 ? (
            <Text style={styles.emptyText}>
              No runs yet. Hit record on the map tab to claim your first cells.
            </Text>
          ) : (
            recentRuns.slice(0, 5).map((run) => <RunRow key={run.id} run={run} />)
          )}
        </View>

        {/* Privacy settings */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Privacy</Text>
          <View style={styles.settingRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.settingLabel}>Fuzz home location</Text>
              <Text style={styles.settingDesc}>Hides your exact home area on the map</Text>
            </View>
            <Switch
              value={locationFuzz}
              onValueChange={setLocationFuzz}
              trackColor={{ false: COLORS.bgElevated, true: COLORS.primary + '66' }}
              thumbColor={locationFuzz ? COLORS.primary : COLORS.textMuted}
            />
          </View>
          <View style={styles.settingRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.settingLabel}>Public profile</Text>
              <Text style={styles.settingDesc}>Allow others to view your stats and territory</Text>
            </View>
            <Switch
              value={publicProfile}
              onValueChange={setPublicProfile}
              trackColor={{ false: COLORS.bgElevated, true: COLORS.primary + '66' }}
              thumbColor={publicProfile ? COLORS.primary : COLORS.textMuted}
            />
          </View>
        </View>

        {/* Account actions */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Account</Text>
          {[
            { icon: 'flag-outline', label: 'Report a user', color: COLORS.warning, onPress: () => {} },
            { icon: 'document-text-outline', label: 'Terms of Service', color: COLORS.textSecondary, onPress: () => {} },
            { icon: 'shield-outline', label: 'Privacy Policy', color: COLORS.textSecondary, onPress: () => {} },
          ].map((item, i) => (
            <TouchableOpacity key={i} style={styles.actionRow} onPress={item.onPress}>
              <Ionicons name={item.icon as any} size={20} color={item.color} />
              <Text style={[styles.actionLabel, { color: item.color }]}>{item.label}</Text>
              <Ionicons name="chevron-forward" size={16} color={COLORS.textMuted} />
            </TouchableOpacity>
          ))}
          <TouchableOpacity style={styles.logoutButton} onPress={handleLogout}>
            <Ionicons name="log-out-outline" size={20} color={COLORS.error} />
            <Text style={styles.logoutText}>Sign Out</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },
  content: { paddingBottom: SPACING.xxl },
  loader: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  profileHeader: { alignItems: 'center', paddingTop: SPACING.xl, paddingBottom: SPACING.lg },
  avatarLarge: { marginBottom: SPACING.md },
  avatarLargeImage: { width: 88, height: 88, borderRadius: 44 },
  avatarLargePlaceholder: {
    width: 88,
    height: 88,
    borderRadius: 44,
    backgroundColor: COLORS.primary + '33',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarLargeInitial: { fontSize: 36, fontWeight: '800', color: COLORS.primary },
  displayName: { fontSize: 24, fontWeight: '800', color: COLORS.textPrimary },
  cityText: { fontSize: 14, color: COLORS.textMuted, marginTop: 4 },
  verifiedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: SPACING.xs,
    backgroundColor: COLORS.primary + '18',
    borderRadius: RADIUS.full,
    paddingHorizontal: SPACING.sm,
    paddingVertical: 3,
  },
  verifiedText: { fontSize: 12, fontWeight: '700', color: COLORS.primary },
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: SPACING.lg,
    gap: SPACING.sm,
    marginBottom: SPACING.md,
  },
  statCard: {
    flex: 1,
    minWidth: '30%',
    backgroundColor: COLORS.bgCard,
    borderRadius: RADIUS.md,
    padding: SPACING.md,
    alignItems: 'center',
    borderWidth: 2,
    borderColor: COLORS.border,
  },
  statValue: { fontSize: 20, fontWeight: '800', color: COLORS.textPrimary },
  statLabel: { fontSize: 11, color: COLORS.textMuted, marginTop: 2, textAlign: 'center' },
  section: {
    marginHorizontal: SPACING.lg,
    marginBottom: SPACING.lg,
    backgroundColor: COLORS.bgCard,
    borderRadius: RADIUS.lg,
    padding: SPACING.md,
    borderWidth: 2,
    borderColor: COLORS.border,
  },
  sectionTitle: { fontSize: 15, fontWeight: '700', color: COLORS.textPrimary, marginBottom: SPACING.md },
  rankHead: { flexDirection: 'row', alignItems: 'center', gap: SPACING.md },
  rankName: { fontSize: 18, fontWeight: '800', color: COLORS.textPrimary },
  rankTrack: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.8,
    color: COLORS.textMuted,
    textTransform: 'uppercase',
    marginTop: 2,
  },
  rankBarTrack: {
    height: 10,
    backgroundColor: COLORS.bgElevated,
    borderWidth: 2,
    borderColor: COLORS.border,
    marginTop: SPACING.md,
  },
  rankBarFill: { height: '100%' },
  rankProgress: {
    fontSize: 13,
    fontWeight: '700',
    color: COLORS.textPrimary,
    marginTop: SPACING.sm,
  },
  rankHint: { fontSize: 12, color: COLORS.textMuted, lineHeight: 17, marginTop: SPACING.xs },
  influenceRow: { flexDirection: 'row', gap: SPACING.sm },
  influenceItem: { flex: 1, alignItems: 'center' },
  influenceValue: { fontSize: 19, fontWeight: '800', color: COLORS.textPrimary },
  influenceLabel: { fontSize: 10, color: COLORS.textMuted, marginTop: 2, textAlign: 'center' },
  // Bars, not a line: the count is a whole number per day and a smoothed curve
  // would imply readings between the snapshots that do not exist.
  spark: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 3,
    height: 44,
    marginTop: SPACING.md,
    paddingTop: SPACING.xs,
    borderTopWidth: 2,
    borderTopColor: COLORS.border,
  },
  sparkBar: { flex: 1, backgroundColor: COLORS.primary, minHeight: 2 },
  influenceHint: { fontSize: 12, color: COLORS.textMuted, lineHeight: 17, marginTop: SPACING.sm },
  researchCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.md,
    marginHorizontal: SPACING.lg,
    marginBottom: SPACING.lg,
    backgroundColor: COLORS.tabActive,
    borderWidth: 3,
    borderColor: COLORS.border,
    padding: SPACING.md,
    ...SHADOWS.card,
  },
  researchTitle: { fontSize: 15, fontWeight: '900', color: COLORS.textPrimary, letterSpacing: 0.5 },
  researchSub: { fontSize: 12, color: COLORS.textPrimary, opacity: 0.75, marginTop: 2 },
  schoolCrest: {
    width: 34, height: 34, alignItems: 'center', justifyContent: 'center',
    borderWidth: 2, borderColor: COLORS.border,
  },
  schoolCrestText: { fontSize: 9, fontWeight: '900', color: '#FFFFFF', letterSpacing: 0.3 },
  emptyText: { fontSize: 14, color: COLORS.textMuted },
  socialRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    paddingVertical: SPACING.sm,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  socialHandle: { flex: 1, fontSize: 14, color: COLORS.textSecondary },
  linkRow: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, marginTop: SPACING.sm },
  platformPicker: { flexDirection: 'row', gap: 4 },
  platformChip: {
    width: 34, height: 34, alignItems: 'center', justifyContent: 'center',
    borderWidth: 2, borderColor: COLORS.border, backgroundColor: COLORS.bgElevated,
  },
  platformChipActive: { backgroundColor: COLORS.tabActive },
  handleInput: {
    flex: 1, borderWidth: 2, borderColor: COLORS.border, backgroundColor: COLORS.bgInput,
    paddingHorizontal: SPACING.sm, paddingVertical: 7, fontSize: 14, color: COLORS.textPrimary,
  },
  linkButton: {
    borderWidth: 2, borderColor: COLORS.border, backgroundColor: COLORS.bgElevated,
    paddingHorizontal: 14, paddingVertical: 8, minWidth: 58, alignItems: 'center',
  },
  linkButtonText: { fontSize: 12, fontWeight: '900', color: COLORS.textPrimary, letterSpacing: 0.8 },
  linkHint: { fontSize: 11, color: COLORS.textMuted, marginTop: SPACING.xs, lineHeight: 16 },
  socialHandleLink: { textDecorationLine: 'underline' },
  unlinkButton: { paddingHorizontal: SPACING.sm, paddingVertical: 4 },
  unlinkText: { fontSize: 12, color: COLORS.error, fontWeight: '600' },
  addSocialButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    paddingTop: SPACING.md,
  },
  addSocialText: { fontSize: 14, color: COLORS.primary, fontWeight: '600' },
  runRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.md,
    paddingVertical: SPACING.sm,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  runDate: { width: 36, alignItems: 'center' },
  runDateDay: { fontSize: 18, fontWeight: '800', color: COLORS.textPrimary },
  runDateMonth: { fontSize: 10, color: COLORS.textMuted, textTransform: 'uppercase' },
  runDistance: { fontSize: 15, fontWeight: '700', color: COLORS.textPrimary },
  runMeta: { fontSize: 12, color: COLORS.textMuted },
  runCells: { fontSize: 12, color: COLORS.primary, fontWeight: '600' },
  settingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: SPACING.sm,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  settingLabel: { fontSize: 14, fontWeight: '600', color: COLORS.textPrimary },
  settingDesc: { fontSize: 12, color: COLORS.textMuted, marginTop: 2 },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.md,
    paddingVertical: SPACING.md,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  actionLabel: { flex: 1, fontSize: 15, fontWeight: '600' },
  logoutButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.md,
    paddingTop: SPACING.md,
  },
  logoutText: { fontSize: 15, fontWeight: '700', color: COLORS.error },
});
