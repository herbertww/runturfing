import React, { useRef, useState } from 'react';
import {
  View,
  Text,
  Modal,
  Pressable,
  StyleSheet,
  ActivityIndicator,
  ScrollView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { showMessage } from 'react-native-flash-message';
import { NEO, SPACING } from '../utils/theme';
import RunShareCard, { CARD_W, CARD_H } from './RunShareCard';
import {
  RunShareData,
  captureCard,
  shareCard,
  saveCardToPhotos,
  shareToStories,
} from '../utils/runShare';

/**
 * The finish sheet: the card, and the three ways out of the app.
 *
 * The card is rendered TWICE. The visible copy is scaled down to fit the sheet
 * with a transform, and the copy that gets captured sits off-screen at its full
 * 360x640. Capturing a transformed view is what produces the blurred, clipped
 * output people complain about in view-shot issues — the transform is applied
 * to the snapshot as well — so the capture target is never the one on screen.
 */

const PREVIEW_W = 268;
const PREVIEW_SCALE = PREVIEW_W / CARD_W;

export default function RunShareSheet({
  visible,
  data,
  onClose,
}: {
  visible: boolean;
  data: RunShareData | null;
  onClose: () => void;
}) {
  const captureTarget = useRef<View>(null);
  const [busy, setBusy] = useState<null | 'share' | 'stories' | 'save'>(null);

  /** Every button follows the same shape: rasterise once, then hand the file on. */
  const withCard = async (kind: 'share' | 'stories' | 'save', run: (uri: string) => Promise<void>) => {
    if (busy) return;
    setBusy(kind);
    try {
      const uri = await captureCard(captureTarget);
      await run(uri);
    } catch {
      showMessage({ message: 'Could not build the card.', type: 'warning' });
    } finally {
      setBusy(null);
    }
  };

  const onShare = () =>
    withCard('share', async (uri) => {
      const ok = await shareCard(uri);
      if (!ok) showMessage({ message: 'Sharing is not available on this device.', type: 'warning' });
    });

  const onSave = () =>
    withCard('save', async (uri) => {
      const res = await saveCardToPhotos(uri);
      if (res === 'saved') showMessage({ message: 'Saved to your photos.', type: 'success' });
      else if (res === 'denied')
        showMessage({
          message: 'Photos access is off.',
          description: 'Turn it on in Settings to save the card.',
          type: 'warning',
        });
      else showMessage({ message: 'Could not save the card.', type: 'warning' });
    });

  const onStories = () =>
    withCard('stories', async (uri) => {
      const res = await shareToStories(uri);
      if (res === 'opened') {
        showMessage({
          message: 'Card saved to your photos.',
          description: 'Pick it in the Instagram composer that just opened.',
          type: 'info',
          duration: 5000,
        });
      } else if (res === 'no_instagram') {
        // Not installed is not a failure worth a dead end. Fall through to the
        // sheet, which is what the user wanted anyway.
        await shareCard(uri);
      } else if (res === 'denied') {
        showMessage({
          message: 'Photos access is off.',
          description: 'Instagram Stories needs it to pick up the card.',
          type: 'warning',
        });
      } else {
        showMessage({ message: 'Could not open Instagram.', type: 'warning' });
      }
    });

  if (!data) return null;

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        {/* Off-screen and full size. This is the view that gets rasterised. */}
        <View style={styles.offscreen} pointerEvents="none">
          <RunShareCard ref={captureTarget} data={data} />
        </View>

        <View style={styles.sheet}>
          <View style={styles.sheetHead}>
            <Text style={styles.sheetTitle}>Run saved</Text>
            <Pressable onPress={onClose} hitSlop={12} accessibilityLabel="Close">
              <Ionicons name="close" size={24} color={NEO.ink} />
            </Pressable>
          </View>

          <ScrollView
            contentContainerStyle={styles.previewWrap}
            showsVerticalScrollIndicator={false}
          >
            <View style={styles.previewBox}>
              <View style={styles.previewScale} pointerEvents="none">
                <RunShareCard data={data} />
              </View>
            </View>
          </ScrollView>

          <View style={styles.actions}>
            <Pressable
              style={[styles.btn, styles.btnPrimary]}
              onPress={onShare}
              disabled={busy !== null}
            >
              {busy === 'share' ? (
                <ActivityIndicator color={NEO.ink} />
              ) : (
                <>
                  <Ionicons name="share-outline" size={18} color={NEO.ink} />
                  <Text style={styles.btnPrimaryText}>Share</Text>
                </>
              )}
            </Pressable>

            <View style={styles.actionRow}>
              <Pressable
                style={[styles.btn, styles.btnGhost, styles.btnHalf]}
                onPress={onStories}
                disabled={busy !== null}
              >
                {busy === 'stories' ? (
                  <ActivityIndicator color={NEO.ink} />
                ) : (
                  <>
                    <Ionicons name="logo-instagram" size={18} color={NEO.ink} />
                    <Text style={styles.btnGhostText}>Stories</Text>
                  </>
                )}
              </Pressable>

              <Pressable
                style={[styles.btn, styles.btnGhost, styles.btnHalf]}
                onPress={onSave}
                disabled={busy !== null}
              >
                {busy === 'save' ? (
                  <ActivityIndicator color={NEO.ink} />
                ) : (
                  <>
                    <Ionicons name="download-outline" size={18} color={NEO.ink} />
                    <Text style={styles.btnGhostText}>Save</Text>
                  </>
                )}
              </Pressable>
            </View>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(28,41,60,0.55)', justifyContent: 'flex-end' },

  // Far enough left that it is never composited into the sheet, but still
  // mounted and laid out, which is what captureRef needs.
  offscreen: { position: 'absolute', left: -9999, top: 0, width: CARD_W, height: CARD_H },

  sheet: {
    backgroundColor: NEO.surface,
    borderTopWidth: NEO.borderWidth,
    borderColor: NEO.black,
    paddingHorizontal: SPACING.md,
    paddingTop: SPACING.md,
    paddingBottom: SPACING.lg,
    maxHeight: '92%',
  },
  sheetHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: SPACING.sm,
  },
  sheetTitle: { fontSize: 20, fontWeight: '900', color: NEO.ink, letterSpacing: -0.4 },

  previewWrap: { alignItems: 'center', paddingVertical: SPACING.sm },
  // The box reserves the SCALED footprint; the card inside is full size and
  // shrunk into it, so the layout does not have to know the card's real height.
  previewBox: {
    width: PREVIEW_W,
    height: CARD_H * PREVIEW_SCALE,
    ...NEO.shadowLg(NEO.black),
  },
  previewScale: {
    width: CARD_W,
    height: CARD_H,
    transform: [{ scale: PREVIEW_SCALE }],
    transformOrigin: 'top left',
  },

  actions: { gap: SPACING.sm, marginTop: SPACING.sm },
  actionRow: { flexDirection: 'row', gap: SPACING.sm },
  btn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 14,
    borderWidth: NEO.borderWidth,
    borderColor: NEO.black,
    ...NEO.shadow(NEO.black),
  },
  btnHalf: { flex: 1 },
  btnPrimary: { backgroundColor: NEO.yellow },
  btnPrimaryText: { fontSize: 16, fontWeight: '900', color: NEO.ink, letterSpacing: 0.3 },
  btnGhost: { backgroundColor: NEO.white },
  btnGhostText: { fontSize: 14, fontWeight: '800', color: NEO.ink, letterSpacing: 0.2 },
});
