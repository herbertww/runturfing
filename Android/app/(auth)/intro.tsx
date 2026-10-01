import React, { useRef, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, FlatList, Image } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import Animated, {
  useSharedValue,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  interpolate,
  Extrapolation,
  FadeInDown,
  FadeInUp,
} from 'react-native-reanimated';
import { NEO, SPACING, SCREEN_WIDTH } from '../../src/utils/theme';
import RunturfingLogo from '../../src/components/RunturfingLogo';
import { INTRO_KEYS, findingByKey } from '../../src/data/research';

// Evidence layer: docs/WALKING_SCIENCE.md, via src/data/research.ts, which the
// in-app research library reads from too — a claim cannot say one thing here
// and another there. Claims stay within the doc's guardrails: population-level
// findings, "roughly" figures, no medical promises. Social findings lead,
// because they explain why the group works. Physiology follows as the stakes.
// Prose follows the writing rules in CLAUDE.md. Do NOT claim the rowers-high
// synchrony effect here; Runturfing is async.
//
// Source links are deliberately not tappable on these slides. Opening a browser
// mid-onboarding drops the runner out of the flow, and most do not come back.
// The same sources are live in the library, reachable from the profile tab.
type Slide = {
  key: string;
  accent: string;
  accentText: string;
  eyebrow: string;
  stat: string;
  statSuffix?: string;
  headline: string;
  body: string;
  source?: string;
  tilt: string;
  /** Slides that show an icon instead of a stat (the opener and the finale). */
  icon?: React.ComponentProps<typeof Ionicons>['name'];
  /** The finale shows the brand mark itself rather than a generic icon. */
  logo?: boolean;
  /** Riso texture plate bleeding up from the bottom edge. Opener only. */
  texture?: boolean;
};

// Presentation only. The words and the citations come from the shared finding;
// this table carries the colour and the tilt, which belong to the slide rather
// than to the research.
const SLIDE_STYLING: Record<string, { accent: string; accentText: string; tilt: string }> = {
  pace: { accent: NEO.violet, accentText: NEO.white, tilt: '-2deg' },
  team: { accent: NEO.green, accentText: NEO.white, tilt: '2deg' },
  spread: { accent: NEO.blue, accentText: NEO.white, tilt: '-2deg' },
  brain: { accent: NEO.amber, accentText: NEO.white, tilt: '2deg' },
  gait: { accent: NEO.red, accentText: NEO.white, tilt: '-2deg' },
};

const EVIDENCE_SLIDES: Slide[] = INTRO_KEYS.flatMap((key) => {
  const f = findingByKey(key);
  const style = SLIDE_STYLING[key];
  if (!f || !style) return [];
  return [{
    key: f.key,
    accent: style.accent,
    accentText: style.accentText,
    tilt: style.tilt,
    eyebrow: f.eyebrow,
    stat: f.stat,
    statSuffix: f.statSuffix,
    headline: f.headline,
    body: f.body,
    source: f.source,
  }];
});

const SLIDES: Slide[] = [
  {
    key: 'premise',
    texture: true,
    accent: NEO.ink,
    accentText: NEO.white,
    eyebrow: 'BUILT ON THE RESEARCH',
    stat: '',
    icon: 'people',
    headline: 'Why you should run with others',
    body:
      'Runturfing builds on exercise psychology and social research to keep a walking or running habit alive. You are ranked against every runner in the season, and your group of six is ranked against the other groups. Your phone removes the obstacle that used to break this, which was getting six people to the same place at the same hour.',
    tilt: '2deg',
  },
  ...EVIDENCE_SLIDES,
  {
    key: 'finale',
    accent: NEO.yellow,
    accentText: NEO.ink,
    eyebrow: 'RUNTURFING',
    stat: '',
    logo: true,
    headline: 'Now go take your streets',
    body:
      'Run a street and it turns your colour on the map. Stop running it and the colour drains back out. Your five teammates watch that happen, and you watch theirs, on whatever schedule each of you keeps.',
    tilt: '-2deg',
  },
];

function SlideView({ slide, index, scrollX }: { slide: Slide; index: number; scrollX: Animated.SharedValue<number> }) {
  const inputRange = [(index - 1) * SCREEN_WIDTH, index * SCREEN_WIDTH, (index + 1) * SCREEN_WIDTH];

  const statStyle = useAnimatedStyle(() => ({
    opacity: interpolate(scrollX.value, inputRange, [0, 1, 0], Extrapolation.CLAMP),
    transform: [
      { translateX: interpolate(scrollX.value, inputRange, [SCREEN_WIDTH * 0.35, 0, -SCREEN_WIDTH * 0.35], Extrapolation.CLAMP) },
      { scale: interpolate(scrollX.value, inputRange, [0.8, 1, 0.8], Extrapolation.CLAMP) },
      { rotate: slide.tilt },
    ],
  }));

  const textStyle = useAnimatedStyle(() => ({
    opacity: interpolate(scrollX.value, inputRange, [0, 1, 0], Extrapolation.CLAMP),
    transform: [
      { translateX: interpolate(scrollX.value, inputRange, [SCREEN_WIDTH * 0.15, 0, -SCREEN_WIDTH * 0.15], Extrapolation.CLAMP) },
    ],
  }));

  return (
    <View style={styles.slide}>
      {slide.logo ? (
        <Animated.View style={[styles.logoSticker, statStyle]}>
          {/* Riso ripple plate sits behind the mark, so the printed rings and
              the drawn ones read as the same idea in two materials. */}
          <Image
            source={require('../../assets/texture-ripple.png')}
            style={styles.logoPlate}
            resizeMode="contain"
          />
          <RunturfingLogo size={150} />
        </Animated.View>
      ) : slide.icon ? (
        <Animated.View style={[styles.sticker, { backgroundColor: slide.accent }, statStyle]}>
          <Ionicons name={slide.icon} size={64} color={slide.accentText} />
        </Animated.View>
      ) : (
        <Animated.View style={[styles.sticker, { backgroundColor: slide.accent }, statStyle]}>
          <Text style={[styles.stat, { color: slide.accentText }]}>
            {slide.stat}
            <Text style={styles.statSuffix}>{slide.statSuffix}</Text>
          </Text>
        </Animated.View>
      )}

      <Animated.View style={textStyle}>
        <View style={styles.eyebrowChip}>
          <Text style={styles.eyebrowText}>{slide.eyebrow}</Text>
        </View>
        <Text style={styles.headline}>{slide.headline}</Text>
        <Text style={styles.body}>{slide.body}</Text>
        {slide.source ? (
          <View style={styles.sourceTag}>
            <Ionicons name="document-text" size={13} color={NEO.ink} />
            <Text style={styles.source}>{slide.source}</Text>
          </View>
        ) : null}
      </Animated.View>
    </View>
  );
}

function Dot({ index, scrollX }: { index: number; scrollX: Animated.SharedValue<number> }) {
  const inputRange = [(index - 1) * SCREEN_WIDTH, index * SCREEN_WIDTH, (index + 1) * SCREEN_WIDTH];
  // Ink fill for the active marker rather than yellow: the pager sits over the
  // riso plate on the opener, and yellow on warm paper loses its edge there.
  const style = useAnimatedStyle(() => ({
    width: interpolate(scrollX.value, inputRange, [10, 28, 10], Extrapolation.CLAMP),
    backgroundColor:
      scrollX.value > (index - 0.5) * SCREEN_WIDTH && scrollX.value < (index + 0.5) * SCREEN_WIDTH
        ? NEO.ink
        : NEO.white,
  }));
  return <Animated.View style={[styles.dot, style]} />;
}

export default function ScienceIntroScreen() {
  const scrollX = useSharedValue(0);
  const [page, setPage] = useState(0);
  const listRef = useRef<FlatList>(null);

  const scrollHandler = useAnimatedScrollHandler((e) => {
    scrollX.value = e.contentOffset.x;
  });

  const onMomentumEnd = (e: any) => {
    setPage(Math.round(e.nativeEvent.contentOffset.x / SCREEN_WIDTH));
  };

  const done = () => router.replace('/(auth)/onboarding');
  const isLast = page === SLIDES.length - 1;

  // The riso plate lives at screen level, not inside a slide, so it can bleed
  // off the bottom edge under the pager instead of being clipped by the list.
  // It belongs to the opener, so it fades out as the first slide leaves.
  const textureStyle = useAnimatedStyle(() => ({
    opacity: interpolate(scrollX.value, [0, SCREEN_WIDTH * 0.9], [0.8, 0], Extrapolation.CLAMP),
  }));

  return (
    <SafeAreaView style={styles.container}>
      <Animated.View style={[styles.texturePlate, textureStyle]} pointerEvents="none">
        <Image
          source={require('../../assets/poster-brutalist.png')}
          style={StyleSheet.absoluteFill}
          resizeMode="cover"
        />
        {/* Paper-to-clear ramp so the plate bleeds up out of the page instead
            of butting against a hard horizontal seam at the midpoint. */}
        <LinearGradient
          colors={[
            'rgba(251,251,249,1)',
            'rgba(251,251,249,0.96)',
            'rgba(251,251,249,0.72)',
            'rgba(251,251,249,0)',
          ]}
          // Holds near-solid paper through the top half of the plate, which is
          // where the body copy lands, then drops away fast. A plain two-stop
          // ramp left ink text sitting on the dark half of the print.
          locations={[0, 0.45, 0.68, 1]}
          style={styles.textureBleed}
        />
      </Animated.View>

      <View style={styles.topBar}>
        <Animated.View entering={FadeInDown.duration(500)} style={styles.brandBlock}>
          <Text style={styles.brand}>RUNTURFING</Text>
        </Animated.View>
        {!isLast && (
          <TouchableOpacity style={styles.skip} onPress={done} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
            <Text style={styles.skipText}>SKIP</Text>
          </TouchableOpacity>
        )}
      </View>

      <Animated.FlatList
        ref={listRef as any}
        data={SLIDES}
        keyExtractor={(s) => s.key}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        bounces={false}
        onScroll={scrollHandler}
        scrollEventThrottle={16}
        onMomentumScrollEnd={onMomentumEnd}
        renderItem={({ item, index }) => <SlideView slide={item} index={index} scrollX={scrollX} />}
      />

      <View style={styles.footer}>
        <View style={styles.dots}>
          {SLIDES.map((s, i) => (
            <Dot key={s.key} index={i} scrollX={scrollX} />
          ))}
        </View>

        {isLast ? (
          <Animated.View entering={FadeInUp.springify().damping(14)} style={styles.ctaWrap}>
            <TouchableOpacity style={styles.cta} onPress={done} activeOpacity={0.85}>
              <Text style={styles.ctaText}>CLAIM YOUR STREETS</Text>
              <Ionicons name="arrow-forward" size={20} color={NEO.ink} style={{ marginLeft: 8 }} />
            </TouchableOpacity>
          </Animated.View>
        ) : (
          <TouchableOpacity
            style={styles.next}
            onPress={() => listRef.current?.scrollToIndex({ index: page + 1, animated: true })}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Ionicons name="arrow-forward" size={24} color={NEO.yellow} />
          </TouchableOpacity>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: NEO.surface },
  topBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: SPACING.lg,
    paddingTop: SPACING.sm,
  },
  brandBlock: {
    backgroundColor: NEO.ink,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  brand: { fontSize: 14, fontWeight: '900', color: NEO.surface, letterSpacing: 2 },
  skip: {
    borderWidth: NEO.borderWidth,
    borderColor: NEO.ink,
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: NEO.white,
    ...NEO.shadow(),
  },
  skipText: { fontSize: 13, fontWeight: '800', color: NEO.ink, letterSpacing: 1 },
  slide: {
    width: SCREEN_WIDTH,
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: SPACING.lg,
  },
  sticker: {
    alignSelf: 'flex-start',
    borderWidth: NEO.borderWidth,
    borderColor: NEO.ink,
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.md,
    marginBottom: SPACING.xl,
    ...NEO.shadowLg(),
  },
  // Riso plate occupies the lower half and bleeds off the bottom edge; the
  // ramp covers its upper third so it dissolves into the paper at midpoint.
  texturePlate: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: '55%',
  },
  textureBleed: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: '84%',
  },
  // The mark carries its own border and shadow, so it needs no sticker frame.
  logoSticker: {
    alignSelf: 'flex-start',
    marginBottom: SPACING.xl,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // The source plate carries its own cream paper, a shade off our surface, so
  // its square edge shows if it is run too strong. Kept low enough that only
  // the printed rings register.
  logoPlate: {
    position: 'absolute',
    width: 250,
    height: 250,
    opacity: 0.32,
  },
  stat: { fontSize: 72, fontWeight: '900', letterSpacing: -2 },
  statSuffix: { fontSize: 28, fontWeight: '800', letterSpacing: -0.5 },
  eyebrowChip: {
    alignSelf: 'flex-start',
    backgroundColor: NEO.ink,
    paddingHorizontal: 8,
    paddingVertical: 4,
    marginBottom: SPACING.md,
  },
  eyebrowText: { fontSize: 11, fontWeight: '800', letterSpacing: 1.5, color: NEO.surface },
  headline: {
    fontSize: 34,
    fontWeight: '900',
    color: NEO.ink,
    letterSpacing: -0.5,
    lineHeight: 40,
    marginBottom: SPACING.md,
    textTransform: 'uppercase',
  },
  // Full-strength ink: the opener's copy overlaps the riso plate, and the 15%
  // knock-down cost it too much contrast there.
  body: { fontSize: 16, color: NEO.ink, lineHeight: 24 },
  sourceTag: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: SPACING.lg,
    borderWidth: 2,
    borderColor: NEO.ink,
    backgroundColor: NEO.surfaceAlt,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  source: { fontSize: 12, fontWeight: '600', color: NEO.ink },
  footer: { paddingHorizontal: SPACING.lg, paddingBottom: SPACING.lg },
  dots: { flexDirection: 'row', gap: 8, marginBottom: SPACING.lg, alignItems: 'center' },
  dot: {
    height: 10,
    borderWidth: 2,
    borderColor: NEO.ink,
  },
  // Ink slab with a yellow arrow. Yellow-on-yellow-paper vanished against the
  // plate; inverting keeps the accent while guaranteeing the button reads.
  next: {
    alignSelf: 'flex-end',
    width: 56,
    height: 56,
    backgroundColor: NEO.ink,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: NEO.borderWidth,
    borderColor: NEO.ink,
    ...NEO.shadow(),
  },
  ctaWrap: { width: '100%' },
  cta: {
    backgroundColor: NEO.yellow,
    borderWidth: NEO.borderWidth,
    borderColor: NEO.ink,
    paddingVertical: 18,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    ...NEO.shadowLg(),
  },
  ctaText: { fontSize: 16, fontWeight: '900', color: NEO.ink, letterSpacing: 1 },
});
