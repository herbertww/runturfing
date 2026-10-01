import React from 'react';
import { View, Text, Image, StyleSheet } from 'react-native';
import { COLORS } from '../utils/theme';
import { ownerVisual } from '../utils/ownerVisual';

/**
 * The holder's face, sitting on the cell they hold.
 *
 * Cell fill is coloured by achievement state, which says how contested ground
 * is but never whose it is — two rivals holding adjacent blocks look identical.
 * This puts the person on the tile.
 *
 * The picture is the point, but most accounts have no avatar, so the fallback
 * has to be identity-bearing rather than a generic placeholder: the holder's
 * initial on a colour derived from their user id, stable between sessions. A
 * grey silhouette on every cell would be worse than no pin at all.
 *
 * Kept deliberately cheap. These are drawn many at a time inside map markers
 * with tracksViewChanges disabled, so no shadows, no animation, and nothing
 * that would force the marker bitmap to be re-rasterised while panning.
 */
export default function CellHolderPin({
  avatarUrl,
  displayName,
  userId,
  isYours,
  size = 22,
}: {
  avatarUrl?: string;
  displayName?: string;
  userId?: string;
  isYours?: boolean;
  size?: number;
}) {
  const { color, initial } = ownerVisual(userId, displayName);
  // Yours is ink-ringed and yellow-backed — the one holder you must be able to
  // pick out of a crowded map instantly.
  const ring = isYours ? COLORS.textPrimary : color;
  const back = isYours ? COLORS.tabActive : color;

  return (
    <View
      style={[
        styles.pin,
        { width: size, height: size, borderRadius: size / 2, borderColor: ring, backgroundColor: back },
      ]}
    >
      {avatarUrl ? (
        <Image
          source={{ uri: avatarUrl }}
          style={{ width: size - 4, height: size - 4, borderRadius: (size - 4) / 2 }}
        />
      ) : (
        <Text
          style={[
            styles.initial,
            { fontSize: size * 0.5, color: isYours ? COLORS.textPrimary : '#fff' },
          ]}
        >
          {initial}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  pin: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    overflow: 'hidden',
  },
  initial: { fontWeight: '900' },
});
