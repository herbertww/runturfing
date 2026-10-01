// RevenueCat wrapper. Season entry is free; the only thing sold is the optional
// rundating bounty (see docs/RUNDATING.md), offered as the "bounty" offering.
import { Platform } from 'react-native';
import Constants from 'expo-constants';
import Purchases, { LOG_LEVEL, PurchasesPackage } from 'react-native-purchases';

const extra = Constants.expoConfig?.extra ?? {};
const apiKey: string | undefined =
  Platform.OS === 'ios' ? extra.revenueCatIosKey : extra.revenueCatAndroidKey;

let configured = false;

/** Safe to call more than once. Without a key the app runs with purchases off. */
export function configurePurchases(): void {
  if (configured || !apiKey) return;
  if (__DEV__) Purchases.setLogLevel(LOG_LEVEL.DEBUG);
  Purchases.configure({ apiKey });
  configured = true;
}

export function purchasesEnabled(): boolean {
  return configured;
}

/** Ties the RevenueCat customer to our user id, or drops back to anonymous. */
export async function identifyPurchaser(userId: string | null): Promise<void> {
  if (!configured) return;
  try {
    if (userId) await Purchases.logIn(userId);
    else if (!(await Purchases.isAnonymous())) await Purchases.logOut();
  } catch {
    // Identity sync retries on the next sign-in; a failure here must not block the app.
  }
}

/** The bounty packages, from the "bounty" offering or the current one. */
export async function getBountyPackages(): Promise<PurchasesPackage[]> {
  if (!configured) return [];
  const offerings = await Purchases.getOfferings();
  const offering = offerings.all.bounty ?? offerings.current;
  return offering?.availablePackages ?? [];
}

/** Returns true when the purchase went through, false when the runner cancelled. */
export async function purchaseBounty(pkg: PurchasesPackage): Promise<boolean> {
  try {
    await Purchases.purchasePackage(pkg);
    return true;
  } catch (e: any) {
    if (e?.userCancelled) return false;
    throw e;
  }
}
