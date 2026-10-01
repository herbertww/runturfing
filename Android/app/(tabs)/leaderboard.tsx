import React, { useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, FlatList,
  ActivityIndicator, Image, RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { leaderboardApi } from '../../src/services/apiClient';
import {
  GroupMetric,
  GroupStanding,
  LeaderboardBoard,
  LeaderboardEntry,
  LeaderboardScope,
  LeaderboardType,
  PerpetualMetric,
  SeasonalMetric,
} from '../../src/types';
import { COLORS, SPACING, RADIUS, SHADOWS } from '../../src/utils/theme';
import RankInsignia from '../../src/components/RankInsignia';
import { useTerritoryStore } from '../../src/stores/territoryStore';
import { demoLeaderboard, fallbackLeaderboard } from '../../src/utils/demoTerritory';

/**
 * Three boards, and the distinction is the thing people get wrong about this
 * screen. All-Time and Season both rank INDIVIDUALS: Season ranks every runner
 * who entered the season against every other one, openly. It is not a board of
 * your six. Groups is the intergroup board, where the groups of six are ranked
 * against each other, and that is the competition the season is built on.
 *
 * The group scope on the individual boards narrows the same open board to your
 * six so you can see where you sit inside it. It does not change what you are
 * competing for. Spec: docs/LEADERBOARD.md.
 */
type TabType = LeaderboardBoard;
type ScopeType = LeaderboardScope;

const BOARD_LABEL: Record<TabType, string> = {
  perpetual: 'All-Time',
  seasonal: 'Season',
  groups: 'Groups',
};

const GROUP_METRICS: Array<{ key: GroupMetric; label: string; icon: string }> = [
  { key: 'season_mileage', label: 'Season km', icon: 'footsteps-outline' },
  { key: 'territory_control', label: 'Territory', icon: 'map-outline' },
  { key: 'defense_consistency', label: 'Defense', icon: 'shield-outline' },
];

const PERPETUAL_METRICS: Array<{ key: PerpetualMetric; label: string; icon: string }> = [
  // Influence leads. Every other territory metric is winner-takes-all, so a
  // runner who is narrowly second across a neighbourhood scores nothing on
  // them; the moving average is where that ground gets counted.
  { key: 'influence_ma', label: 'Influence', icon: 'pulse-outline' },
  { key: 'alltime_mileage', label: 'All-Time km', icon: 'footsteps-outline' },
  { key: 'mileage_90d', label: '90-Day km', icon: 'trending-up-outline' },
  { key: 'cells_led', label: 'Cells Led', icon: 'flag-outline' },
  { key: 'territory_held', label: 'Territory', icon: 'map-outline' },
  { key: 'rank', label: 'Rank', icon: 'ribbon-outline' },
  { key: 'streak', label: 'Streak', icon: 'flame-outline' },
];

const SEASONAL_METRICS: Array<{ key: SeasonalMetric; label: string; icon: string }> = [
  { key: 'season_mileage', label: 'Season km', icon: 'footsteps-outline' },
  { key: 'territory_control', label: 'Territory', icon: 'map-outline' },
  { key: 'defense_consistency', label: 'Defense', icon: 'shield-outline' },
  { key: 'threshold_progress', label: 'Progress', icon: 'bar-chart-outline' },
];

const RANK_COLORS = ['#FFD700', '#C0C0C0', '#CD7F32'];

function RankBadge({ rank }: { rank: number }) {
  if (rank <= 3) {
    return (
      <View style={[styles.rankBadge, { backgroundColor: RANK_COLORS[rank - 1] + '22' }]}>
        <Text style={[styles.rankBadgeText, { color: RANK_COLORS[rank - 1] }]}>#{rank}</Text>
      </View>
    );
  }
  return (
    <View style={styles.rankBadge}>
      <Text style={styles.rankBadgeTextMuted}>#{rank}</Text>
    </View>
  );
}

function LeaderboardRow({ entry }: { entry: LeaderboardEntry }) {
  return (
    <View style={[styles.row, entry.isCurrentUser && styles.rowHighlight]}>
      <RankBadge rank={entry.rank} />
      <View style={styles.avatar}>
        {entry.avatarUrl ? (
          <Image source={{ uri: entry.avatarUrl }} style={styles.avatarImage} />
        ) : (
          <View style={styles.avatarPlaceholder}>
            <Text style={styles.avatarInitial}>
              {entry.displayName.charAt(0).toUpperCase()}
            </Text>
          </View>
        )}
      </View>
      <View style={{ flex: 1 }}>
        <View style={styles.nameRow}>
          <Text style={[styles.name, entry.isCurrentUser && { color: COLORS.primary }]}>
            {entry.displayName}
            {entry.isCurrentUser && ' (you)'}
          </Text>
          {entry.rankCode && entry.rankTrack && (
            <RankInsignia code={entry.rankCode} track={entry.rankTrack} size="sm" />
          )}
        </View>
        {/* Whatever the board is sorted on, the influence average travels with
            the row — it is the figure that says how much ground someone works
            without necessarily winning it. */}
        <Text style={styles.city}>
          {entry.influenceMa30 !== undefined
            ? `${entry.influenceMa30.toFixed(1)} avg influence`
            : ''}
          {entry.city ? `${entry.influenceMa30 !== undefined ? ' · ' : ''}${entry.city}` : ''}
        </Text>
      </View>
      <View style={{ alignItems: 'flex-end' }}>
        <Text style={styles.value}>{entry.value.toLocaleString()}</Text>
        <Text style={styles.unit}>{entry.unit}</Text>
      </View>
      {entry.delta !== undefined && entry.delta !== 0 && (
        <View style={styles.delta}>
          <Ionicons
            name={entry.delta > 0 ? 'arrow-up' : 'arrow-down'}
            size={10}
            color={entry.delta > 0 ? COLORS.success : COLORS.error}
          />
          <Text style={[styles.deltaText, { color: entry.delta > 0 ? COLORS.success : COLORS.error }]}>
            {Math.abs(entry.delta)}
          </Text>
        </View>
      )}
    </View>
  );
}

/** A group on the intergroup board. No avatar and no rank insignia: the unit
 *  being ranked here is the group, and six faces in a list row is a smear. */
function GroupRow({ entry }: { entry: GroupStanding }) {
  return (
    <View style={[styles.row, entry.isMyGroup && styles.rowHighlight]}>
      <RankBadge rank={entry.rank} />
      <View style={styles.groupMark}>
        <Ionicons name="people" size={18} color={COLORS.textPrimary} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[styles.name, entry.isMyGroup && { color: COLORS.primary }]}>
          {entry.groupName}
          {entry.isMyGroup && ' (yours)'}
        </Text>
        <Text style={styles.city}>
          {entry.members} {entry.members === 1 ? 'runner' : 'runners'}
        </Text>
      </View>
      <View style={{ alignItems: 'flex-end' }}>
        <Text style={styles.value}>{entry.value.toLocaleString()}</Text>
        <Text style={styles.unit}>{entry.unit}</Text>
      </View>
    </View>
  );
}

export default function LeaderboardScreen() {
  const [tab, setTab] = useState<TabType>('perpetual');
  const [scope, setScope] = useState<ScopeType>('global');
  const [metric, setMetric] = useState<PerpetualMetric | SeasonalMetric>('alltime_mileage');
  const [groupMetric, setGroupMetric] = useState<GroupMetric>('season_mileage');

  const { cells, demoMode } = useTerritoryStore();

  const showingGroups = tab === 'groups';

  const { data, isLoading, isError, refetch, isRefetching } = useQuery({
    queryKey: ['leaderboard', tab, scope, metric],
    queryFn: () =>
      leaderboardApi
        .get({ type: tab as LeaderboardType, metric: metric as any, scope })
        .then((r) => r.data),
    staleTime: 60_000,
    // The demo city has its own board, built from the same cells the map draws.
    enabled: !demoMode && !showingGroups,
  });

  const groupQuery = useQuery({
    queryKey: ['leaderboard-groups', groupMetric],
    queryFn: () => leaderboardApi.getGroups({ metric: groupMetric }).then((r) => r.data),
    staleTime: 60_000,
    enabled: !demoMode && showingGroups,
  });

  // leaderboard_daily only fills once the hourly materializer job has run
  // (Backend/api/jobs/leaderboard_materialize.py, wired up outside the API as
  // a cron job) — until then, or if the call itself fails, the real board has
  // nothing to show. Fall back to a placeholder rather than a blank tab.
  const usingFallback =
    !demoMode && !showingGroups && !isLoading && (isError || (data?.entries.length ?? 0) === 0);
  const entries = demoMode
    ? demoLeaderboard(cells)
    : usingFallback
      ? fallbackLeaderboard(metric)
      : data?.entries ?? [];

  const metrics =
    tab === 'perpetual' ? PERPETUAL_METRICS : tab === 'seasonal' ? SEASONAL_METRICS : GROUP_METRICS;
  const activeMetric = showingGroups ? groupMetric : metric;
  const groupEntries = groupQuery.data?.entries ?? [];

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.title}>Leaderboard</Text>
        {usingFallback && (
          <Text style={styles.sampleBanner}>Sample data — live rankings coming soon</Text>
        )}
      </View>

      {/* All-Time / Season / Groups. The first two rank runners, the third
          ranks groups against each other. */}
      <View style={styles.tabRow}>
        {(['perpetual', 'seasonal', 'groups'] as const).map((t) => (
          <TouchableOpacity
            key={t}
            style={[styles.tab, tab === t && styles.tabActive]}
            onPress={() => {
              setTab(t);
              if (t === 'perpetual') setMetric('alltime_mileage');
              if (t === 'seasonal') setMetric('season_mileage');
            }}
          >
            <Text style={[styles.tabText, tab === t && styles.tabTextActive]}>
              {BOARD_LABEL[t]}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* One line saying what is being ranked. The season board is open across
          everyone who entered, and people assume it is their six unless told. */}
      <Text style={styles.boardNote}>
        {showingGroups
          ? 'Every group in the season, ranked against each other on the group total.'
          : tab === 'seasonal'
            ? scope === 'group'
              ? 'Your six, pulled out of the open season board. Your real standing is Everyone.'
              : 'Every runner in the season, ranked against each other.'
            : scope === 'group'
              ? 'Your six, pulled out of the all-time board.'
              : 'Every runner, all time.'}
      </Text>

      {/* Scope filters. Groups has no scope: it is already one board. */}
      {!showingGroups && (
        <View style={styles.scopeRow}>
          {(['global', 'city', 'group'] as const).map((s) => (
            <TouchableOpacity
              key={s}
              style={[styles.scopeChip, scope === s && styles.scopeChipActive]}
              onPress={() => setScope(s)}
            >
              <Text style={[styles.scopeText, scope === s && styles.scopeTextActive]}>
                {s === 'global' ? 'Everyone' : s === 'city' ? 'City' : 'My group'}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      )}

      {/* Metric selector */}
      <View style={styles.metricRow}>
        {metrics.map((m) => (
          <TouchableOpacity
            key={m.key}
            style={[styles.metricChip, activeMetric === m.key && styles.metricChipActive]}
            onPress={() =>
              showingGroups ? setGroupMetric(m.key as GroupMetric) : setMetric(m.key as any)
            }
          >
            <Ionicons
              name={m.icon as any}
              size={14}
              color={activeMetric === m.key ? COLORS.primary : COLORS.textMuted}
            />
            <Text style={[styles.metricText, activeMetric === m.key && styles.metricTextActive]}>
              {m.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* List */}
      {(showingGroups ? groupQuery.isLoading : isLoading) && !demoMode ? (
        <View style={styles.loader}>
          <ActivityIndicator size="large" color={COLORS.primary} />
        </View>
      ) : showingGroups ? (
        <FlatList
          data={groupEntries}
          keyExtractor={(item) => item.groupId}
          renderItem={({ item }) => <GroupRow entry={item} />}
          contentContainerStyle={{ paddingBottom: SPACING.xxl }}
          refreshControl={
            <RefreshControl
              refreshing={groupQuery.isRefetching}
              onRefresh={groupQuery.refetch}
              tintColor={COLORS.primary}
            />
          }
          ListEmptyComponent={
            <View style={styles.empty}>
              <Ionicons name="people-outline" size={48} color={COLORS.textMuted} />
              <Text style={styles.emptyText}>
                {groupQuery.isError ? 'Could not load the group board' : 'No groups matched yet'}
              </Text>
            </View>
          }
          ListFooterComponent={
            groupQuery.data?.myGroup ? (
              <View>
                <View style={styles.divider} />
                <GroupRow entry={groupQuery.data.myGroup} />
              </View>
            ) : null
          }
        />
      ) : (
        <FlatList
          data={entries}
          keyExtractor={(item) => item.userId}
          renderItem={({ item }) => <LeaderboardRow entry={item} />}
          contentContainerStyle={{ paddingBottom: SPACING.xxl }}
          refreshControl={
            <RefreshControl
              refreshing={isRefetching}
              onRefresh={refetch}
              tintColor={COLORS.primary}
            />
          }
          ListEmptyComponent={
            <View style={styles.empty}>
              <Ionicons name="trophy-outline" size={48} color={COLORS.textMuted} />
              <Text style={styles.emptyText}>No data yet</Text>
            </View>
          }
          ListFooterComponent={
            !usingFallback && data?.currentUserEntry && !data.entries.find((e) => e.isCurrentUser) ? (
              <View>
                <View style={styles.divider} />
                <LeaderboardRow entry={data.currentUserEntry} />
              </View>
            ) : null
          }
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },
  boardNote: {
    fontSize: 12,
    color: COLORS.textMuted,
    paddingHorizontal: SPACING.lg,
    marginBottom: SPACING.sm,
    lineHeight: 17,
  },
  groupMark: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.bgElevated,
    borderWidth: 2,
    borderColor: COLORS.border,
  },
  header: { paddingHorizontal: SPACING.lg, paddingTop: SPACING.md, paddingBottom: SPACING.sm },
  title: { fontSize: 26, fontWeight: '800', color: COLORS.textPrimary },
  sampleBanner: { fontSize: 12, color: COLORS.textMuted, marginTop: 2 },
  tabRow: {
    flexDirection: 'row',
    marginHorizontal: SPACING.lg,
    backgroundColor: COLORS.bgInput,
    borderRadius: RADIUS.md,
    padding: 3,
    marginBottom: SPACING.md,
  },
  tab: { flex: 1, paddingVertical: SPACING.sm, alignItems: 'center', borderRadius: RADIUS.sm },
  tabActive: { backgroundColor: COLORS.primary },
  tabText: { fontSize: 14, fontWeight: '600', color: COLORS.textMuted },
  tabTextActive: { color: '#fff' },
  scopeRow: {
    flexDirection: 'row',
    paddingHorizontal: SPACING.lg,
    gap: SPACING.sm,
    marginBottom: SPACING.sm,
  },
  scopeChip: {
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.xs,
    borderRadius: RADIUS.full,
    borderWidth: 2,
    borderColor: COLORS.border,
    backgroundColor: COLORS.bgCard,
  },
  scopeChipActive: { borderColor: COLORS.primary, backgroundColor: COLORS.primary + '22' },
  scopeText: { fontSize: 13, color: COLORS.textMuted, fontWeight: '600' },
  scopeTextActive: { color: COLORS.primary },
  metricRow: {
    flexDirection: 'row',
    paddingHorizontal: SPACING.lg,
    gap: SPACING.xs,
    marginBottom: SPACING.md,
    flexWrap: 'wrap',
  },
  metricChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: SPACING.sm,
    paddingVertical: SPACING.xs,
    borderRadius: RADIUS.full,
    borderWidth: 2,
    borderColor: COLORS.border,
    gap: 4,
  },
  metricChipActive: { borderColor: COLORS.primary, backgroundColor: COLORS.primary + '18' },
  metricText: { fontSize: 12, color: COLORS.textMuted, fontWeight: '600' },
  metricTextActive: { color: COLORS.primary },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.md,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
    gap: SPACING.sm,
  },
  rowHighlight: { backgroundColor: COLORS.primary + '0A' },
  rankBadge: {
    width: 36,
    height: 36,
    borderRadius: RADIUS.sm,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.bgElevated,
  },
  rankBadgeText: { fontSize: 13, fontWeight: '800' },
  rankBadgeTextMuted: { fontSize: 13, fontWeight: '700', color: COLORS.textMuted },
  avatar: { width: 40, height: 40 },
  avatarImage: { width: 40, height: 40, borderRadius: 20 },
  avatarPlaceholder: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: COLORS.primary + '33',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInitial: { fontSize: 16, fontWeight: '700', color: COLORS.primary },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: SPACING.xs, flexWrap: 'wrap' },
  name: { fontSize: 15, fontWeight: '600', color: COLORS.textPrimary },
  city: { fontSize: 12, color: COLORS.textMuted },
  value: { fontSize: 17, fontWeight: '800', color: COLORS.textPrimary },
  unit: { fontSize: 11, color: COLORS.textMuted },
  delta: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  deltaText: { fontSize: 11, fontWeight: '700' },
  loader: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: SPACING.xxl, gap: SPACING.md },
  emptyText: { fontSize: 16, color: COLORS.textMuted },
  divider: { height: 1, backgroundColor: COLORS.border, marginVertical: SPACING.sm },
});
