import React, { useState, useEffect, useMemo } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  ActivityIndicator, Image, RefreshControl, Share, TextInput,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { showMessage } from 'react-native-flash-message';
import { seasonsApi, profileApi, institutionsApi } from '../../src/services/apiClient';
import { Season, SeasonEntry, SeasonGroup, ThresholdProgress } from '../../src/types';
import { useTerritoryStore } from '../../src/stores/territoryStore';
import { useAuthStore } from '../../src/stores/authStore';
import {
  purchasesEnabled, getBountyPackages, purchaseBounty,
} from '../../src/services/purchases';
import {
  demoSeason,
  demoSeasonEntry,
  demoSeasonGroup,
  demoReferrals,
  demoInstitutionStandings,
  demoMyInstitution,
} from '../../src/utils/demoData';
import { COLORS, SPACING, RADIUS, SHADOWS } from '../../src/utils/theme';

// Share links resolve to the school's join page on the marketing site, which
// deep-links into the app when it is installed and to the store when it is not.
const SHARE_ORIGIN = 'https://runturfing.com';

function useCountdown(endsAt: string) {
  const [timeLeft, setTimeLeft] = useState({ days: 0, hours: 0, minutes: 0, seconds: 0 });

  useEffect(() => {
    const tick = () => {
      const diff = new Date(endsAt).getTime() - Date.now();
      if (diff <= 0) {
        setTimeLeft({ days: 0, hours: 0, minutes: 0, seconds: 0 });
        return;
      }
      setTimeLeft({
        days: Math.floor(diff / 86400000),
        hours: Math.floor((diff % 86400000) / 3600000),
        minutes: Math.floor((diff % 3600000) / 60000),
        seconds: Math.floor((diff % 60000) / 1000),
      });
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [endsAt]);

  return timeLeft;
}

function CountdownUnit({ value, label }: { value: number; label: string }) {
  return (
    <View style={styles.countdownUnit}>
      <Text style={styles.countdownValue}>{String(value).padStart(2, '0')}</Text>
      <Text style={styles.countdownLabel}>{label}</Text>
    </View>
  );
}

function ThresholdBar({ progress }: { progress: ThresholdProgress }) {
  const items = [
    { label: 'Runs', done: progress.runsCompleted, total: progress.runsRequired },
    { label: 'km', done: Math.round(progress.kmCompleted), total: progress.kmRequired },
    { label: 'Days', done: progress.activeDays, total: progress.activeDaysRequired },
  ];

  return (
    <View style={styles.thresholdCard}>
      <View style={styles.thresholdHeader}>
        <Text style={styles.thresholdTitle}>Activity Threshold</Text>
        <View style={[styles.thresholdBadge, progress.isMet && styles.thresholdBadgeMet]}>
          <Ionicons
            name={progress.isMet ? 'checkmark-circle' : 'time-outline'}
            size={14}
            color={progress.isMet ? COLORS.success : COLORS.warning}
          />
          <Text style={[styles.thresholdBadgeText, progress.isMet && { color: COLORS.success }]}>
            {progress.isMet ? 'Met' : 'In Progress'}
          </Text>
        </View>
      </View>
      {items.map((item) => {
        const pct = Math.min(item.done / item.total, 1);
        return (
          <View key={item.label} style={styles.progressRow}>
            <Text style={styles.progressLabel}>{item.label}</Text>
            <View style={styles.progressTrack}>
              <View style={[styles.progressFill, { width: `${pct * 100}%` as any }]} />
            </View>
            <Text style={styles.progressValue}>
              {item.done}/{item.total}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

/**
 * Runfluence — the referral bounty multiplier.
 *
 * Signups and paid referrals are shown as separate numbers on purpose. A signup
 * moves nothing; only a referral who has actually paid raises the multiplier,
 * and the women's bonus lands at settlement once she is genuinely paid out.
 * Collapsing them into one figure would imply a signup is worth money, which is
 * the impression that makes people farm accounts.
 */
function RunfluenceCard() {
  const { demoMode } = useTerritoryStore();
  const queryClient = useQueryClient();
  const [code, setCode] = useState('');
  const [redeeming, setRedeeming] = useState(false);

  const { data: fetched, isLoading } = useQuery({
    queryKey: ['referrals'],
    queryFn: () => profileApi.getReferrals().then((r) => r.data),
    staleTime: 60_000,
    enabled: !demoMode,
  });
  const data = demoMode ? demoReferrals() : fetched;

  if ((isLoading && !demoMode) || !data) {
    return (
      <View style={styles.runfluenceCard}>
        <ActivityIndicator size="small" color={COLORS.primary} />
      </View>
    );
  }

  const share = async () => {
    try {
      await Share.share({
        message:
          `Run with me on Runturfing. Use my code ${data.code} when you join a season.`,
      });
    } catch {
      // Sheet dismissed; nothing to report.
    }
  };

  const redeem = async () => {
    if (!code.trim()) return;
    if (demoMode) {
      showMessage({ message: 'Demo mode — codes are not stored.', type: 'info' });
      setCode('');
      return;
    }
    setRedeeming(true);
    try {
      await profileApi.redeemReferral(code.trim());
      showMessage({ message: 'Code applied.', type: 'success' });
      setCode('');
      queryClient.invalidateQueries({ queryKey: ['referrals'] });
    } catch (e: any) {
      showMessage({
        message: e?.response?.data?.detail ?? 'Could not apply that code.',
        type: 'danger',
      });
    } finally {
      setRedeeming(false);
    }
  };

  const pct = (f: number) => `${Math.round(f * 100)}%`;

  return (
    <View style={styles.runfluenceCard}>
      <View style={styles.runfluenceHead}>
        <Ionicons name="megaphone-outline" size={20} color={COLORS.warning} />
        <Text style={styles.sectionTitle}>Runfluence</Text>
        <View style={styles.multiplierPill}>
          <Text style={styles.multiplierText}>{data.multiplier.toFixed(2)}x</Text>
        </View>
      </View>

      <Text style={styles.runfluenceBlurb}>
        Your share of the season bounty is multiplied by the people you bring in.
        A referral counts once they have paid their entry, and counts for more
        once she is paid out at the end of the season.
      </Text>

      <TouchableOpacity style={styles.codeRow} onPress={share} activeOpacity={0.85}>
        <View>
          <Text style={styles.codeLabel}>YOUR CODE</Text>
          <Text style={styles.codeValue}>{data.code}</Text>
        </View>
        <View style={styles.shareButton}>
          <Ionicons name="share-outline" size={18} color={COLORS.textPrimary} />
          <Text style={styles.shareText}>SHARE</Text>
        </View>
      </TouchableOpacity>

      <View style={styles.statRow}>
        {[
          { n: data.signedUp, label: 'Signed up', note: 'worth nothing yet' },
          { n: data.paidEntries, label: 'Paid entry', note: `+${pct(data.perReferralBonus)} each` },
          { n: data.paidWomen, label: 'Paid out', note: `+${pct(data.perWomanBonus)} more` },
        ].map((s) => (
          <View key={s.label} style={styles.statCell}>
            <Text style={styles.statNum}>{s.n}</Text>
            <Text style={styles.statCaption}>{s.label}</Text>
            <Text style={styles.statNote}>{s.note}</Text>
          </View>
        ))}
      </View>

      {data.atCap ? (
        <Text style={styles.capNote}>
          You are at the {data.maxMultiplier}x cap. Further referrals will not raise it.
        </Text>
      ) : null}

      {data.referredBy ? (
        <Text style={styles.referredBy}>Brought in by {data.referredBy}.</Text>
      ) : (
        <View style={styles.redeemRow}>
          <TextInput
            style={styles.redeemInput}
            value={code}
            onChangeText={setCode}
            placeholder="Got a code?"
            placeholderTextColor={COLORS.textMuted}
            autoCapitalize="characters"
            autoCorrect={false}
            maxLength={12}
          />
          <TouchableOpacity
            style={styles.redeemButton}
            onPress={redeem}
            disabled={redeeming || !code.trim()}
          >
            {redeeming ? (
              <ActivityIndicator size="small" color={COLORS.textPrimary} />
            ) : (
              <Text style={styles.redeemText}>APPLY</Text>
            )}
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

/**
 * The optional rundating bounty, sold through RevenueCat. Entry stays free; this
 * only buys a guaranteed mixed group, so it is offered to men alone and says
 * plainly where the money goes. See docs/RUNDATING.md.
 */
function BountyCard() {
  const { demoMode } = useTerritoryStore();
  const [buying, setBuying] = useState(false);

  const { data: packages, isLoading } = useQuery({
    queryKey: ['bounty-packages'],
    queryFn: getBountyPackages,
    staleTime: 5 * 60_000,
    enabled: !demoMode && purchasesEnabled(),
  });
  const pkg = packages?.[0];

  const buy = async () => {
    if (demoMode) {
      showMessage({ message: 'Demo mode — nothing is charged.', type: 'info' });
      return;
    }
    if (!pkg) return;
    setBuying(true);
    try {
      const done = await purchaseBounty(pkg);
      if (done) {
        showMessage({
          message: "Bounty posted. You'll be placed in a mixed group of six.",
          type: 'success',
        });
      }
    } catch (e: any) {
      showMessage({ message: e?.message ?? 'The purchase did not go through.', type: 'danger' });
    } finally {
      setBuying(false);
    }
  };

  const price = pkg?.product.priceString;

  return (
    <View style={styles.runfluenceCard}>
      <View style={styles.runfluenceHead}>
        <Ionicons name="heart-outline" size={20} color={COLORS.warning} />
        <Text style={styles.sectionTitle}>Rundating bounty</Text>
      </View>

      <Text style={styles.runfluenceBlurb}>
        Optional. Post a bounty and you are placed in a mixed group: three men,
        three women. Half funds the app. The other half is held until the season
        ends, then paid in equal shares to the women who meet the activity bar.
      </Text>

      {isLoading && !demoMode ? (
        <ActivityIndicator size="small" color={COLORS.primary} />
      ) : !pkg && !demoMode ? (
        <Text style={styles.capNote}>The bounty is not on sale right now.</Text>
      ) : (
        <TouchableOpacity style={styles.redeemButton} onPress={buy} disabled={buying}>
          {buying ? (
            <ActivityIndicator size="small" color={COLORS.textPrimary} />
          ) : (
            <Text style={styles.redeemText}>
              {price ? `POST BOUNTY · ${price}` : 'POST BOUNTY'}
            </Text>
          )}
        </TouchableOpacity>
      )}
    </View>
  );
}

/**
 * The orientation season's school table, plus the invite that names the school.
 *
 * The invite copy carries the caller's school and its current position, because
 * a share that says "we're 4th, come fix it" is acted on and a share that says
 * "try this running app" is not. The referral code rides along so a schoolmate
 * brought in this way still counts toward the sender's Runfluence multiplier.
 */
function OrientationCard() {
  const { demoMode } = useTerritoryStore();

  // Same query key as RunfluenceCard, so react-query serves it from cache
  // rather than fetching the referral standing twice on one screen.
  const { data: fetchedReferrals } = useQuery({
    queryKey: ['referrals'],
    queryFn: () => profileApi.getReferrals().then((r) => r.data),
    staleTime: 60_000,
    enabled: !demoMode,
  });
  const referralCode = (demoMode ? demoReferrals() : fetchedReferrals)?.code;

  const { data: fetchedMine } = useQuery({
    queryKey: ['institution-me'],
    queryFn: () => institutionsApi.getMine().then((r) => r.data),
    staleTime: 60_000,
    enabled: !demoMode,
  });
  const mine = demoMode ? demoMyInstitution() : fetchedMine;

  const { data: fetchedTable, isLoading } = useQuery({
    queryKey: ['institution-standings'],
    queryFn: () => institutionsApi.getStandings().then((r) => r.data),
    staleTime: 60_000,
    enabled: !demoMode,
  });
  const table = demoMode ? demoInstitutionStandings() : fetchedTable;

  if ((isLoading && !demoMode) || !table) {
    return (
      <View style={styles.runfluenceCard}>
        <ActivityIndicator size="small" color={COLORS.primary} />
      </View>
    );
  }

  const school = mine?.institution ?? null;
  const myRow = school
    ? table.standings.find((s) => s.slug === school.slug)
    : undefined;

  // Only the top eight render. The full table is long enough to bury the invite
  // button below the fold, and the schools outside it are not the ones anyone
  // is arguing about in a group chat.
  const shown = table.standings.slice(0, 8);
  const myRowHidden = myRow && myRow.rank > shown.length;

  const shareToSchool = async () => {
    if (!school) return;
    const position = myRow ? `${ordinal(myRow.rank)} of ${table.standings.length}` : 'unranked';
    const code = referralCode ? `\n\nUse my code ${referralCode} when you sign up.` : '';
    try {
      await Share.share({
        message:
          `${school.shortName} is sitting ${position} in Runturfing's orientation season. ` +
          `Every street you run turns your colour and counts for the school.` +
          `${code}\n\n${SHARE_ORIGIN}/join/${school.slug}`,
      });
    } catch {
      // Sheet dismissed; nothing to report.
    }
  };

  return (
    <View style={styles.runfluenceCard}>
      <View style={styles.runfluenceHead}>
        <Ionicons name="school-outline" size={20} color={COLORS.primary} />
        <Text style={styles.sectionTitle}>School standings</Text>
        {myRow && (
          <View style={styles.multiplierPill}>
            <Text style={styles.multiplierText}>{ordinal(myRow.rank)}</Text>
          </View>
        )}
      </View>

      <Text style={styles.runfluenceBlurb}>
        Ranked by total ground held. Every schoolmate you bring in adds to it,
        so the invite is always worth sending.
      </Text>

      <View style={styles.tableHead}>
        <Text style={[styles.tableHeadText, { width: 26 }]}>#</Text>
        <Text style={[styles.tableHeadText, { flex: 1 }]}>School</Text>
        <Text style={[styles.tableHeadText, styles.tableNumCol]}>Turf</Text>
        <Text style={[styles.tableHeadText, styles.tableNumCol]}>Runners</Text>
      </View>

      {shown.map((s) => {
        const isMine = school?.slug === s.slug;
        return (
          <View key={s.slug} style={[styles.tableRow, isMine && styles.tableRowMine]}>
            <Text style={[styles.tableRank, isMine && styles.tableTextMine]}>{s.rank}</Text>
            <View style={[styles.tableSwatch, { backgroundColor: s.color }]} />
            <Text
              style={[styles.tableName, isMine && styles.tableTextMine]}
              numberOfLines={1}
            >
              {s.shortName}
            </Text>
            <Text style={[styles.tableNum, styles.tableNumCol]}>{s.turfCells}</Text>
            <Text style={[styles.tableNum, styles.tableNumCol]}>{s.activeRunners}</Text>
          </View>
        );
      })}

      {myRowHidden && (
        <View style={[styles.tableRow, styles.tableRowMine]}>
          <Text style={[styles.tableRank, styles.tableTextMine]}>{myRow!.rank}</Text>
          <View style={[styles.tableSwatch, { backgroundColor: myRow!.color }]} />
          <Text style={[styles.tableName, styles.tableTextMine]} numberOfLines={1}>
            {myRow!.shortName}
          </Text>
          <Text style={[styles.tableNum, styles.tableNumCol]}>{myRow!.turfCells}</Text>
          <Text style={[styles.tableNum, styles.tableNumCol]}>{myRow!.activeRunners}</Text>
        </View>
      )}

      {school ? (
        <>
          {mine?.contribution && (
            <Text style={styles.contribution}>
              You are holding {mine.contribution.turfCells} cells for{' '}
              {school.shortName} off {mine.contribution.km.toFixed(1)} km.
              {typeof mine.teammates === 'number' &&
                ` ${mine.teammates} others are running under the same crest.`}
            </Text>
          )}
          <TouchableOpacity
            style={styles.schoolShareButton}
            onPress={shareToSchool}
            activeOpacity={0.85}
          >
            <Ionicons name="share-social-outline" size={18} color={COLORS.textPrimary} />
            <Text style={styles.schoolShareText}>
              BRING IN {school.shortName.toUpperCase()}
            </Text>
          </TouchableOpacity>
        </>
      ) : (
        <Text style={styles.contribution}>
          You have not picked a school. Set one from your profile and your turf
          starts counting toward it.
        </Text>
      )}
    </View>
  );
}

function ordinal(n: number): string {
  // 11th–13th are the exception every naive implementation gets wrong.
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  return `${n}${['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`;
}

export default function SeasonScreen() {
  const { demoMode } = useTerritoryStore();

  // Frozen for the session, same as demoTerritory.ts: a season/entry/group
  // regenerated on every render would desync from itself (the countdown would
  // drift against a new endsAt each tick) and re-trigger effects downstream.
  const demoSeasonData = useMemo(() => (demoMode ? demoSeason() : null), [demoMode]);
  const demoEntryData = useMemo(() => (demoMode ? demoSeasonEntry() : null), [demoMode]);
  const demoGroupData = useMemo(() => (demoMode ? demoSeasonGroup() : null), [demoMode]);

  const { data: fetchedSeason, isLoading: loadingSeason, refetch } = useQuery({
    queryKey: ['season-current'],
    queryFn: () => seasonsApi.getCurrent().then((r) => r.data),
    staleTime: 60_000,
    enabled: !demoMode,
  });
  const season = demoMode ? demoSeasonData! : fetchedSeason;

  const { data: fetchedEntry, isLoading: loadingEntry } = useQuery({
    queryKey: ['season-entry'],
    queryFn: () => seasonsApi.getMyEntry().then((r) => r.data),
    staleTime: 30_000,
    enabled: !demoMode,
  });
  const entry = demoMode ? demoEntryData! : fetchedEntry;

  const { data: fetchedGroup, isLoading: loadingGroup } = useQuery({
    queryKey: ['season-group', season?.id],
    queryFn: () => seasonsApi.getMyGroup(season!.id).then((r) => r.data),
    enabled: !demoMode && !!season?.id && !!entry?.groupId,
    staleTime: 30_000,
  });
  const group = demoMode ? demoGroupData! : fetchedGroup;

  // Memoize the fallback: a fresh ISO string every render would re-trigger the
  // countdown effect each second's setState, causing an infinite update loop.
  const fallbackEndsAt = useMemo(() => new Date(Date.now() + 14 * 86400000).toISOString(), []);
  const countdown = useCountdown(season?.endsAt ?? fallbackEndsAt);
  const isLoading = !demoMode && (loadingSeason || loadingEntry);

  // Orientation seasons have no pool and no groups of 6. They keep the
  // countdown and the threshold, and swap the payout surfaces for the school
  // table, so the screen is one layout with two readings rather than two screens.
  const isOrientation = season?.kind === 'orientation';
  const isMan = useAuthStore((st) => st.user?.gender === 'male');

  const queryClient = useQueryClient();
  const [joining, setJoining] = useState(false);

  const join = async (seasonId: string) => {
    if (demoMode) {
      showMessage({ message: "Demo mode — this doesn't create a real entry.", type: 'info' });
      return;
    }
    setJoining(true);
    try {
      const { data } = await seasonsApi.join(seasonId);
      // Entry is free, so the server settles it on the spot and there is no
      // Stripe step to send anyone to. Most runners never press this button at
      // all: a run inside the season window enters them on its own, which is
      // why a repeat press reports the entry that already exists.
      showMessage({
        message: data.already_entered
          ? "You were already in. Go take some ground."
          : "You're in. Go take some ground.",
        type: 'success',
      });
      queryClient.invalidateQueries({ queryKey: ['season-entry'] });
      queryClient.invalidateQueries({ queryKey: ['season-current'] });
      queryClient.invalidateQueries({ queryKey: ['institution-standings'] });
    } catch (e: any) {
      showMessage({
        message: e?.response?.data?.detail ?? 'Could not join the season.',
        type: 'danger',
      });
    } finally {
      setJoining(false);
    }
  };

  if (isLoading) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <View style={styles.loader}>
          <ActivityIndicator size="large" color={COLORS.primary} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl refreshing={false} onRefresh={refetch} tintColor={COLORS.primary} />
        }
      >
        {/* Header */}
        <View style={styles.header}>
          <View>
            {/* The season is branded Runner's Inferno; the number is the
                edition, so it rides below the name rather than replacing it. */}
            <Text style={styles.title}>
              {isOrientation ? 'ORIENTATION' : "RUNNER'S INFERNO"}
            </Text>
            <Text style={styles.seasonOrdinal}>
              {isOrientation
                ? 'SINGAPORE · INAUGURAL'
                : `SEASON ${season?.number ?? '—'}`}
            </Text>
          </View>
          <View style={[styles.statusBadge, season?.status === 'active' && styles.statusActive]}>
            <View style={[styles.statusDot, season?.status === 'active' && styles.statusDotActive]} />
            <Text style={[styles.statusText, season?.status === 'active' && styles.statusTextActive]}>
              {season?.status ?? 'Loading'}
            </Text>
          </View>
        </View>

        {/* Countdown */}
        <View style={styles.countdownCard}>
          <Text style={styles.countdownTitle}>
            {isOrientation
              ? season?.status === 'active' ? 'Orientation ends in' : 'Orientation starts in'
              : season?.status === 'active' ? 'Inferno ends in' : 'Inferno starts in'}
          </Text>
          <View style={styles.countdownRow}>
            <CountdownUnit value={countdown.days} label="Days" />
            <Text style={styles.countdownSep}>:</Text>
            <CountdownUnit value={countdown.hours} label="Hrs" />
            <Text style={styles.countdownSep}>:</Text>
            <CountdownUnit value={countdown.minutes} label="Min" />
            <Text style={styles.countdownSep}>:</Text>
            <CountdownUnit value={countdown.seconds} label="Sec" />
          </View>
          {season && (
            <Text style={styles.countdownDates}>
              {new Date(season.startsAt).toLocaleDateString()} –{' '}
              {new Date(season.endsAt).toLocaleDateString()}
            </Text>
          )}
        </View>

        {/* School standings. Above the pool, because in an orientation season
            the table is the scoreboard and there is no pool to speak of. */}
        {isOrientation && <OrientationCard />}

        {/* Season pool. An orientation season is free, so there is nothing to
            show here and a $0.00 pool would only read as broken. */}
        {season && !isOrientation && (
          <View style={styles.poolCard}>
            <View style={styles.poolRow}>
              <Ionicons name="wallet-outline" size={20} color={COLORS.warning} />
              <Text style={styles.poolLabel}>Season Pool</Text>
              <Text style={styles.poolAmount}>
                ${(season.poolAmount / 100).toFixed(2)} {season.currency.toUpperCase()}
              </Text>
            </View>
            {entry && (
              <View style={styles.poolRow}>
                <Ionicons name="person-outline" size={20} color={COLORS.primary} />
                <Text style={styles.poolLabel}>Your entry</Text>
                <Text style={[styles.poolAmount, { color: COLORS.primary }]}>
                  ${(entry.bidAmount / 100).toFixed(2)}
                </Text>
              </View>
            )}
          </View>
        )}

        {/* Runfluence referral multiplier */}
        <RunfluenceCard />

        {/* Rundating bounty: men only, and never in orientation seasons */}
        {!isOrientation && isMan && <BountyCard />}

        {/* Threshold progress */}
        {entry?.thresholdProgress && (
          <ThresholdBar progress={entry.thresholdProgress} />
        )}

        {/* Group roster */}
        {group ? (
          <View style={styles.groupCard}>
            <Text style={styles.sectionTitle}>Your Group</Text>
            {group.members.map((member) => (
              <View key={member.userId} style={styles.memberRow}>
                <View style={styles.memberAvatar}>
                  {member.avatarUrl ? (
                    <Image source={{ uri: member.avatarUrl }} style={styles.memberAvatarImage} />
                  ) : (
                    <View style={styles.memberAvatarPlaceholder}>
                      <Text style={styles.memberAvatarInitial}>
                        {member.displayName.charAt(0).toUpperCase()}
                      </Text>
                    </View>
                  )}
                  <View style={[
                    styles.genderDot,
                    { backgroundColor: member.gender === 'female' ? '#FF6B9D' : '#6C63FF' }
                  ]} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.memberName}>{member.displayName}</Text>
                  <Text style={styles.memberStats}>
                    {member.totalKm.toFixed(1)} km · {member.runsCompleted} runs · {member.activeDays} days
                  </Text>
                </View>
                <View style={styles.memberBadges}>
                  {member.thresholdMet && (
                    <Ionicons name="checkmark-circle" size={16} color={COLORS.success} />
                  )}
                  {member.socialLinked && (
                    <Ionicons name="share-social-outline" size={16} color={COLORS.primary} />
                  )}
                </View>
              </View>
            ))}
          </View>
        ) : (
          <View style={styles.noGroupCard}>
            <Ionicons
              name={isOrientation ? 'school-outline' : 'people-outline'}
              size={48}
              color={COLORS.textMuted}
            />
            <Text style={styles.noGroupTitle}>
              {isOrientation ? 'Not entered yet' : 'Not in a group yet'}
            </Text>
            <Text style={styles.noGroupSubtitle}>
              {isOrientation
                ? 'Entry is free for the inaugural season. Your turf starts counting for your school the moment you join.'
                : 'Join the season to be matched with 5 other runners in your city.'}
            </Text>
            <TouchableOpacity
              style={styles.joinButton}
              disabled={!season || joining}
              onPress={() => season && join(season.id)}
            >
              <Text style={styles.joinButtonText}>
                {joining ? 'Joining…' : isOrientation ? 'Enter for free' : 'Join Season'}
              </Text>
            </TouchableOpacity>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },
  content: { padding: SPACING.lg, gap: SPACING.md },
  loader: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { fontSize: 26, fontWeight: '900', color: COLORS.textPrimary, letterSpacing: -0.5 },
  seasonOrdinal: {
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 2,
    color: COLORS.textSecondary,
    marginTop: 2,
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: SPACING.sm,
    paddingVertical: 4,
    borderRadius: RADIUS.full,
    backgroundColor: COLORS.bgCard,
    borderWidth: 2,
    borderColor: COLORS.border,
    gap: 6,
  },
  statusActive: { borderColor: COLORS.success + '66', backgroundColor: COLORS.success + '11' },
  statusDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: COLORS.textMuted },
  statusDotActive: { backgroundColor: COLORS.success },
  statusText: { fontSize: 12, fontWeight: '700', color: COLORS.textMuted },
  statusTextActive: { color: COLORS.success },
  countdownCard: {
    backgroundColor: COLORS.bgCard,
    borderRadius: RADIUS.lg,
    padding: SPACING.lg,
    alignItems: 'center',
    borderWidth: 2,
    borderColor: COLORS.border,
    ...SHADOWS.card,
  },
  countdownTitle: { fontSize: 13, color: COLORS.textMuted, fontWeight: '600', marginBottom: SPACING.md, textTransform: 'uppercase', letterSpacing: 1 },
  countdownRow: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm },
  countdownUnit: { alignItems: 'center', minWidth: 56 },
  countdownValue: { fontSize: 40, fontWeight: '800', color: COLORS.textPrimary, letterSpacing: -1 },
  countdownLabel: { fontSize: 11, color: COLORS.textMuted, fontWeight: '600', textTransform: 'uppercase' },
  countdownSep: { fontSize: 32, fontWeight: '800', color: COLORS.textMuted, marginBottom: 12 },
  countdownDates: { fontSize: 12, color: COLORS.textMuted, marginTop: SPACING.md },
  poolCard: {
    backgroundColor: COLORS.bgCard,
    borderRadius: RADIUS.md,
    padding: SPACING.md,
    borderWidth: 2,
    borderColor: COLORS.border,
    gap: SPACING.sm,
  },
  poolRow: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm },
  poolLabel: { flex: 1, fontSize: 14, color: COLORS.textSecondary },
  poolAmount: { fontSize: 16, fontWeight: '700', color: COLORS.warning },
  thresholdCard: {
    backgroundColor: COLORS.bgCard,
    borderRadius: RADIUS.md,
    padding: SPACING.md,
    borderWidth: 2,
    borderColor: COLORS.border,
    gap: SPACING.sm,
  },
  thresholdHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: SPACING.xs },
  thresholdTitle: { fontSize: 15, fontWeight: '700', color: COLORS.textPrimary },
  thresholdBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: SPACING.sm,
    paddingVertical: 3,
    borderRadius: RADIUS.full,
    backgroundColor: COLORS.warning + '22',
  },
  thresholdBadgeMet: { backgroundColor: COLORS.success + '22' },
  thresholdBadgeText: { fontSize: 12, fontWeight: '700', color: COLORS.warning },
  progressRow: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm },
  progressLabel: { width: 36, fontSize: 12, color: COLORS.textMuted, fontWeight: '600' },
  progressTrack: {
    flex: 1,
    height: 6,
    backgroundColor: COLORS.bgElevated,
    borderRadius: RADIUS.full,
    overflow: 'hidden',
  },
  progressFill: { height: '100%', backgroundColor: COLORS.primary, borderRadius: RADIUS.full },
  progressValue: { width: 40, fontSize: 12, color: COLORS.textSecondary, textAlign: 'right', fontWeight: '600' },
  groupCard: {
    backgroundColor: COLORS.bgCard,
    borderRadius: RADIUS.md,
    padding: SPACING.md,
    borderWidth: 2,
    borderColor: COLORS.border,
    gap: SPACING.sm,
  },
  // No horizontal margin: the ScrollView's contentContainer already pads by
  // SPACING.lg, and adding the same again here inset this card 48px a side
  // while every other card on the screen sat at 24. Its `gap` also spaces the
  // siblings, so the old marginBottom was doubling the rhythm below it too.
  runfluenceCard: {
    backgroundColor: COLORS.bgCard,
    borderWidth: 3,
    borderColor: COLORS.border,
    padding: SPACING.md,
    gap: SPACING.sm,
    boxShadow: '4px 4px 0px #111111',
  },
  runfluenceHead: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm },
  multiplierPill: {
    marginLeft: 'auto',
    backgroundColor: COLORS.tabActive,
    borderWidth: 2,
    borderColor: COLORS.border,
    paddingHorizontal: 10,
    paddingVertical: 3,
  },
  multiplierText: { fontSize: 15, fontWeight: '900', color: COLORS.textPrimary, letterSpacing: 0.5 },
  runfluenceBlurb: { fontSize: 13, color: COLORS.textSecondary, lineHeight: 19 },
  codeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: COLORS.bgElevated,
    borderWidth: 2,
    borderColor: COLORS.border,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
  },
  codeLabel: { fontSize: 10, fontWeight: '800', letterSpacing: 1.2, color: COLORS.textMuted },
  codeValue: { fontSize: 24, fontWeight: '900', letterSpacing: 3, color: COLORS.textPrimary },
  shareButton: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: COLORS.tabActive,
    borderWidth: 2, borderColor: COLORS.border,
    paddingHorizontal: 12, paddingVertical: 8,
  },
  shareText: { fontSize: 12, fontWeight: '900', color: COLORS.textPrimary, letterSpacing: 0.8 },
  statRow: { flexDirection: 'row', borderWidth: 2, borderColor: COLORS.border },
  statCell: { flex: 1, padding: SPACING.sm, alignItems: 'center' },
  statNum: { fontSize: 22, fontWeight: '900', color: COLORS.textPrimary },
  statCaption: { fontSize: 10, fontWeight: '800', letterSpacing: 0.8, color: COLORS.textSecondary, textTransform: 'uppercase' },
  statNote: { fontSize: 10, color: COLORS.textMuted, marginTop: 1 },
  capNote: { fontSize: 12, fontWeight: '700', color: COLORS.warning },
  tableHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    paddingHorizontal: SPACING.xs,
    paddingBottom: 4,
    borderBottomWidth: 2,
    borderBottomColor: COLORS.border,
  },
  tableHeadText: {
    fontSize: 10, fontWeight: '800', letterSpacing: 0.8,
    color: COLORS.textMuted, textTransform: 'uppercase',
  },
  // Both numeric columns are fixed and right-aligned so the digits line up
  // down the table instead of drifting with the school name's length.
  tableNumCol: { width: 52, textAlign: 'right' },
  tableRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    paddingHorizontal: SPACING.xs,
    paddingVertical: 7,
  },
  tableRowMine: { backgroundColor: COLORS.tabActive + '33' },
  tableRank: { width: 26, fontSize: 13, fontWeight: '800', color: COLORS.textMuted },
  tableSwatch: { width: 10, height: 18, borderWidth: 1, borderColor: COLORS.border },
  tableName: { flex: 1, fontSize: 14, fontWeight: '700', color: COLORS.textPrimary },
  tableTextMine: { color: COLORS.textPrimary },
  tableNum: { fontSize: 13, fontWeight: '700', color: COLORS.textSecondary },
  contribution: { fontSize: 12, color: COLORS.textSecondary, lineHeight: 18 },
  schoolShareButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: COLORS.tabActive,
    borderWidth: 2,
    borderColor: COLORS.border,
    paddingVertical: 12,
  },
  schoolShareText: { fontSize: 13, fontWeight: '900', color: COLORS.textPrimary, letterSpacing: 0.8 },
  referredBy: { fontSize: 12, color: COLORS.textMuted, fontStyle: 'italic' },
  redeemRow: { flexDirection: 'row', gap: SPACING.sm },
  redeemInput: {
    flex: 1, borderWidth: 2, borderColor: COLORS.border,
    backgroundColor: COLORS.bgInput, paddingHorizontal: SPACING.sm,
    paddingVertical: 8, fontSize: 15, fontWeight: '700',
    letterSpacing: 2, color: COLORS.textPrimary,
  },
  redeemButton: {
    borderWidth: 2, borderColor: COLORS.border, backgroundColor: COLORS.bgElevated,
    paddingHorizontal: 16, justifyContent: 'center', minWidth: 76, alignItems: 'center',
  },
  redeemText: { fontSize: 12, fontWeight: '900', color: COLORS.textPrimary, letterSpacing: 0.8 },
  sectionTitle: { fontSize: 15, fontWeight: '700', color: COLORS.textPrimary, marginBottom: SPACING.xs },
  memberRow: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, paddingVertical: SPACING.xs },
  memberAvatar: { position: 'relative' },
  memberAvatarImage: { width: 40, height: 40, borderRadius: 20 },
  memberAvatarPlaceholder: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: COLORS.primary + '33',
    alignItems: 'center',
    justifyContent: 'center',
  },
  memberAvatarInitial: { fontSize: 16, fontWeight: '700', color: COLORS.primary },
  genderDot: { position: 'absolute', bottom: 0, right: 0, width: 12, height: 12, borderRadius: 6, borderWidth: 2, borderColor: COLORS.bgCard },
  memberName: { fontSize: 14, fontWeight: '600', color: COLORS.textPrimary },
  memberStats: { fontSize: 12, color: COLORS.textMuted },
  memberBadges: { flexDirection: 'row', gap: SPACING.xs },
  noGroupCard: {
    backgroundColor: COLORS.bgCard,
    borderRadius: RADIUS.lg,
    padding: SPACING.xl,
    alignItems: 'center',
    borderWidth: 2,
    borderColor: COLORS.border,
    gap: SPACING.md,
  },
  noGroupTitle: { fontSize: 18, fontWeight: '700', color: COLORS.textPrimary },
  noGroupSubtitle: { fontSize: 14, color: COLORS.textSecondary, textAlign: 'center', lineHeight: 20 },
  joinButton: {
    backgroundColor: COLORS.primary,
    borderRadius: RADIUS.md,
    paddingVertical: SPACING.md,
    paddingHorizontal: SPACING.xl,
    marginTop: SPACING.sm,
  },
  joinButtonText: { fontSize: 15, fontWeight: '700', color: '#fff' },
});
