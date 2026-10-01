import React, { useState, useRef } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView,
  Dimensions, Animated, TextInput, Alert, Platform,
} from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { NEO, SPACING } from '../../src/utils/theme';
import RunturfingLogo from '../../src/components/RunturfingLogo';
import InstitutionPicker from '../../src/components/InstitutionPicker';
import { institutionsApi } from '../../src/services/apiClient';
import { useAuthStore, ALLOW_DEV_BYPASS } from '../../src/stores/authStore';

const { width } = Dimensions.get('window');

type Step = 'welcome' | 'age-gate' | 'create-account' | 'school' | 'permissions';

export default function OnboardingScreen() {
  const devBypassLogin = useAuthStore((s) => s.devBypassLogin);
  const [step, setStep] = useState<Step>('welcome');
  const [school, setSchool] = useState<string | null>(null);
  const [savingSchool, setSavingSchool] = useState(false);
  const [dobDay, setDobDay] = useState('');
  const [dobMonth, setDobMonth] = useState('');
  const [dobYear, setDobYear] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [gender, setGender] = useState<'male' | 'female' | 'other' | null>(null);
  const fadeAnim = useRef(new Animated.Value(1)).current;

  const transition = (next: Step) => {
    Animated.sequence([
      Animated.timing(fadeAnim, { toValue: 0, duration: 150, useNativeDriver: true }),
      Animated.timing(fadeAnim, { toValue: 1, duration: 200, useNativeDriver: true }),
    ]).start();
    setTimeout(() => setStep(next), 150);
  };

  const checkAge = () => {
    const day = parseInt(dobDay, 10);
    const month = parseInt(dobMonth, 10);
    const year = parseInt(dobYear, 10);
    if (!day || !month || !year || year < 1900 || year > 2100) {
      Alert.alert('Invalid Date', 'Please enter a valid date of birth.');
      return;
    }
    const dob = new Date(year, month - 1, day);
    const today = new Date();
    const age = today.getFullYear() - dob.getFullYear() -
      (today < new Date(today.getFullYear(), dob.getMonth(), dob.getDate()) ? 1 : 0);
    if (age < 18) {
      Alert.alert('Age Requirement', 'You must be 18 or older to use Runturfing.');
      return;
    }
    transition('create-account');
  };

  const renderWelcome = () => (
    <View style={styles.stepContainer}>
      <View style={styles.logoContainer}>
        <View style={styles.logoIcon}>
          <RunturfingLogo size={128} />
        </View>
        <Text style={styles.logoText}>RUNTURFING</Text>
        <View style={styles.taglineChip}>
          <Text style={styles.tagline}>OWN YOUR CITY'S STREETS</Text>
        </View>
      </View>

      <View style={styles.featureList}>
        {[
          { icon: 'map-outline', text: 'Claim territory by running your routes', color: NEO.violet },
          { icon: 'people-outline', text: 'Compete in seasonal groups of 6', color: NEO.green },
          { icon: 'trophy-outline', text: 'Climb the perpetual leaderboard', color: NEO.amber },
          { icon: 'chatbubbles-outline', text: 'Group chat tied to your territory', color: NEO.blue },
        ].map((f, i) => (
          <View key={i} style={styles.featureRow}>
            <View style={[styles.featureIcon, { backgroundColor: f.color }]}>
              <Ionicons name={f.icon as any} size={20} color={NEO.white} />
            </View>
            <Text style={styles.featureText}>{f.text}</Text>
          </View>
        ))}
      </View>

      <TouchableOpacity style={styles.primaryButton} onPress={() => transition('age-gate')}>
        <Text style={styles.primaryButtonText}>GET STARTED</Text>
        <Ionicons name="arrow-forward" size={18} color={NEO.ink} style={{ marginLeft: 8 }} />
      </TouchableOpacity>

      <TouchableOpacity style={styles.secondaryButton} onPress={() => router.push('/(auth)/login')}>
        <Text style={styles.secondaryButtonText}>I already have an account</Text>
      </TouchableOpacity>

      {ALLOW_DEV_BYPASS && devBypassLogin && (
        <TouchableOpacity
          style={[styles.secondaryButton, { marginTop: SPACING.sm }]}
          onPress={async () => {
            // Await it: this is a real network login now, and navigating first
            // landed on the map with no token yet.
            await devBypassLogin();
            router.replace('/(tabs)/map');
          }}
        >
          <Text style={[styles.secondaryButtonText, { color: NEO.amber }]}>
            Sign in as tester
          </Text>
        </TouchableOpacity>
      )}
    </View>
  );

  const renderAgeGate = () => (
    <View style={styles.stepContainer}>
      <TouchableOpacity style={styles.backButton} onPress={() => transition('welcome')}>
        <Ionicons name="arrow-back" size={22} color={NEO.ink} />
      </TouchableOpacity>
      <Text style={styles.stepTitle}>AGE VERIFICATION</Text>
      <Text style={styles.stepSubtitle}>
        Runturfing is for users 18 and older. Please enter your date of birth.
      </Text>

      <View style={styles.dobRow}>
        <TextInput
          style={[styles.dobInput, { flex: 1 }]}
          placeholder="DD"
          placeholderTextColor={NEO.ink + '55'}
          keyboardType="number-pad"
          maxLength={2}
          value={dobDay}
          onChangeText={setDobDay}
        />
        <Text style={styles.dobSep}>/</Text>
        <TextInput
          style={[styles.dobInput, { flex: 1 }]}
          placeholder="MM"
          placeholderTextColor={NEO.ink + '55'}
          keyboardType="number-pad"
          maxLength={2}
          value={dobMonth}
          onChangeText={setDobMonth}
        />
        <Text style={styles.dobSep}>/</Text>
        <TextInput
          style={[styles.dobInput, { flex: 2 }]}
          placeholder="YYYY"
          placeholderTextColor={NEO.ink + '55'}
          keyboardType="number-pad"
          maxLength={4}
          value={dobYear}
          onChangeText={setDobYear}
        />
      </View>

      <Text style={styles.privacyNote}>
        Your date of birth is used only for age verification and is never shared.
      </Text>

      <TouchableOpacity style={styles.primaryButton} onPress={checkAge}>
        <Text style={styles.primaryButtonText}>CONTINUE</Text>
      </TouchableOpacity>
    </View>
  );

  const renderCreateAccount = () => (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.stepContainer}>
      <TouchableOpacity style={styles.backButton} onPress={() => transition('age-gate')}>
        <Ionicons name="arrow-back" size={22} color={NEO.ink} />
      </TouchableOpacity>
      <Text style={styles.stepTitle}>CREATE ACCOUNT</Text>
      <Text style={styles.stepSubtitle}>Join the competition.</Text>

      <TextInput
        style={styles.input}
        placeholder="Display name"
        placeholderTextColor={NEO.ink + '55'}
        value={displayName}
        onChangeText={setDisplayName}
        autoCapitalize="words"
      />
      <TextInput
        style={[styles.input, { marginTop: SPACING.sm }]}
        placeholder="Email address"
        placeholderTextColor={NEO.ink + '55'}
        value={email}
        onChangeText={setEmail}
        keyboardType="email-address"
        autoCapitalize="none"
      />
      <TextInput
        style={[styles.input, { marginTop: SPACING.sm }]}
        placeholder="Password (min 8 characters)"
        placeholderTextColor={NEO.ink + '55'}
        value={password}
        onChangeText={setPassword}
        secureTextEntry
      />

      <Text style={styles.label}>GENDER</Text>
      <View style={styles.genderRow}>
        {(['male', 'female', 'other'] as const).map((g) => (
          <TouchableOpacity
            key={g}
            style={[styles.genderButton, gender === g && styles.genderButtonActive]}
            onPress={() => setGender(g)}
          >
            <Text style={[styles.genderText, gender === g && styles.genderTextActive]}>
              {g.charAt(0).toUpperCase() + g.slice(1)}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <TouchableOpacity
        style={[styles.primaryButton, { marginTop: SPACING.xl }]}
        onPress={() => {
          if (!displayName || !email || !password || !gender) {
            Alert.alert('Missing Info', 'Please fill in all fields.');
            return;
          }
          transition('school');
        }}
      >
        <Text style={styles.primaryButtonText}>CREATE ACCOUNT</Text>
      </TouchableOpacity>
    </ScrollView>
  );

  /**
   * School opt-in. It sits after account creation because the PUT needs a
   * token, and before permissions because a student who has just picked their
   * campus has a reason to grant location that a cold permissions prompt does
   * not give them.
   *
   * Skipping is a first-class outcome. Runturfing is not a students-only app,
   * and a blocking school gate would turn away everyone who has graduated.
   */
  const saveSchoolAndContinue = async (slug: string | null) => {
    setSavingSchool(true);
    try {
      if (slug) await institutionsApi.setMine(slug);
    } catch {
      // A failed opt-in is recoverable from the profile screen. Blocking
      // onboarding on it would strand the account that was just created.
      Alert.alert(
        'Saved for later',
        'We could not set your school just now. You can pick it from your profile.'
      );
    } finally {
      setSavingSchool(false);
      transition('permissions');
    }
  };

  const renderSchool = () => (
    <View style={[styles.stepContainer, { justifyContent: 'flex-start', paddingTop: SPACING.xxl }]}>
      <Text style={styles.stepTitle}>PICK YOUR SCHOOL</Text>
      <Text style={styles.stepSubtitle}>
        The first season scores schools against each other. Every cell you hold
        counts for the crest you run under.
      </Text>

      <InstitutionPicker
        value={school}
        onChange={setSchool}
        showSkip
        onSkip={() => saveSchoolAndContinue(null)}
      />

      <TouchableOpacity
        style={[styles.primaryButton, !school && styles.primaryButtonDisabled]}
        disabled={!school || savingSchool}
        onPress={() => saveSchoolAndContinue(school)}
      >
        <Text style={styles.primaryButtonText}>
          {savingSchool ? 'SAVING…' : 'RUN FOR THIS SCHOOL'}
        </Text>
      </TouchableOpacity>
    </View>
  );

  const renderPermissions = () => (
    <View style={styles.stepContainer}>
      <Text style={styles.stepTitle}>ENABLE PERMISSIONS</Text>
      <Text style={styles.stepSubtitle}>
        Runturfing needs these to track your runs and show your territory.
      </Text>

      {[
        {
          icon: 'location-outline',
          title: 'Location (Always)',
          desc: 'Required to record runs in the background and build your territory map.',
          color: NEO.violet,
        },
        {
          icon: 'fitness-outline',
          title: 'Activity Recognition',
          desc: 'Detects when you start running to auto-import workouts.',
          color: NEO.green,
        },
        {
          icon: 'notifications-outline',
          title: 'Notifications',
          desc: 'Alerts when your territory is challenged or a season event occurs.',
          color: NEO.amber,
        },
      ].map((p, i) => (
        <View key={i} style={styles.permissionCard}>
          <View style={[styles.permissionIcon, { backgroundColor: p.color }]}>
            <Ionicons name={p.icon as any} size={24} color={NEO.white} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.permissionTitle}>{p.title}</Text>
            <Text style={styles.permissionDesc}>{p.desc}</Text>
          </View>
        </View>
      ))}

      <TouchableOpacity
        style={[styles.primaryButton, { marginTop: SPACING.xl }]}
        onPress={() => router.replace('/(tabs)/map')}
      >
        <Text style={styles.primaryButtonText}>ALLOW & ENTER APP</Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={{ marginTop: SPACING.md, alignItems: 'center' }}
        onPress={() => router.replace('/(tabs)/map')}
      >
        <Text style={styles.secondaryButtonText}>Skip for now</Text>
      </TouchableOpacity>
    </View>
  );

  return (
    <SafeAreaView style={styles.container}>
      <Animated.View style={{ flex: 1, opacity: fadeAnim }}>
        {step === 'welcome' && renderWelcome()}
        {step === 'age-gate' && renderAgeGate()}
        {step === 'create-account' && renderCreateAccount()}
        {step === 'school' && renderSchool()}
        {step === 'permissions' && renderPermissions()}
      </Animated.View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: NEO.surface },
  stepContainer: {
    flex: 1,
    padding: SPACING.lg,
    justifyContent: 'center',
  },
  logoContainer: { alignItems: 'center', marginBottom: SPACING.xxl },
  // The mark draws its own border and hard shadow, so the wrapper only carries
  // the tilt and the spacing below it.
  logoIcon: {
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: SPACING.md,
    transform: [{ rotate: '-3deg' }],
  },
  logoText: { fontSize: 32, fontWeight: '900', color: NEO.ink, letterSpacing: 0 },
  taglineChip: {
    backgroundColor: NEO.ink,
    paddingHorizontal: 10,
    paddingVertical: 4,
    marginTop: SPACING.sm,
  },
  tagline: { fontSize: 12, fontWeight: '800', color: NEO.surface, letterSpacing: 1.5 },
  featureList: { marginBottom: SPACING.xl },
  featureRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: SPACING.sm,
    borderWidth: 2,
    borderColor: NEO.ink,
    backgroundColor: NEO.white,
    padding: SPACING.sm,
    ...NEO.shadow(),
  },
  featureIcon: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: SPACING.md,
    borderWidth: 2,
    borderColor: NEO.ink,
  },
  featureText: { fontSize: 15, fontWeight: '600', color: NEO.ink, flex: 1 },
  primaryButton: {
    backgroundColor: NEO.yellow,
    borderWidth: NEO.borderWidth,
    borderColor: NEO.ink,
    paddingVertical: 16,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    ...NEO.shadowLg(),
  },
  primaryButtonText: { fontSize: 16, fontWeight: '900', color: NEO.ink, letterSpacing: 1 },
  // Flat, not faded: the hard shadow is the affordance in this system, so
  // removing it reads as "not pressable" more clearly than lowering opacity.
  primaryButtonDisabled: { backgroundColor: NEO.surfaceAlt, boxShadow: 'none' },
  secondaryButton: { marginTop: SPACING.md, alignItems: 'center', padding: SPACING.xs },
  secondaryButtonText: { fontSize: 15, fontWeight: '600', color: NEO.ink, opacity: 0.7 },
  backButton: {
    position: 'absolute',
    top: SPACING.md,
    left: SPACING.lg,
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: NEO.ink,
    backgroundColor: NEO.white,
    ...NEO.shadow(),
  },
  stepTitle: { fontSize: 28, fontWeight: '900', color: NEO.ink, marginBottom: SPACING.sm },
  stepSubtitle: { fontSize: 15, color: NEO.ink, opacity: 0.75, marginBottom: SPACING.xl, lineHeight: 22 },
  dobRow: { flexDirection: 'row', alignItems: 'center', marginBottom: SPACING.md },
  dobInput: {
    backgroundColor: NEO.white,
    borderWidth: NEO.borderWidth,
    borderColor: NEO.ink,
    padding: SPACING.md,
    fontSize: 18,
    fontWeight: '700',
    color: NEO.ink,
    textAlign: 'center',
  },
  dobSep: { fontSize: 24, fontWeight: '800', color: NEO.ink, marginHorizontal: SPACING.sm },
  privacyNote: { fontSize: 13, color: NEO.ink, opacity: 0.6, marginBottom: SPACING.xl, lineHeight: 18 },
  input: {
    backgroundColor: NEO.white,
    borderWidth: NEO.borderWidth,
    borderColor: NEO.ink,
    padding: SPACING.md,
    fontSize: 16,
    fontWeight: '600',
    color: NEO.ink,
  },
  label: {
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 1.5,
    color: NEO.ink,
    marginTop: SPACING.lg,
    marginBottom: SPACING.sm,
  },
  genderRow: { flexDirection: 'row', gap: SPACING.sm },
  genderButton: {
    flex: 1,
    paddingVertical: SPACING.md,
    borderWidth: 2,
    borderColor: NEO.ink,
    alignItems: 'center',
    backgroundColor: NEO.white,
  },
  genderButtonActive: { backgroundColor: NEO.yellow, ...NEO.shadow() },
  genderText: { fontSize: 14, fontWeight: '700', color: NEO.ink, opacity: 0.6 },
  genderTextActive: { opacity: 1 },
  permissionCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: NEO.white,
    borderWidth: 2,
    borderColor: NEO.ink,
    padding: SPACING.md,
    marginBottom: SPACING.sm,
    ...NEO.shadow(),
  },
  permissionIcon: {
    width: 48,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: SPACING.md,
    borderWidth: 2,
    borderColor: NEO.ink,
  },
  permissionTitle: { fontSize: 15, fontWeight: '800', color: NEO.ink, marginBottom: 2 },
  permissionDesc: { fontSize: 13, color: NEO.ink, opacity: 0.7, lineHeight: 18 },
});
