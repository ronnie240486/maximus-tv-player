import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import {
  getAvatar,
  getKidAvatar,
  isKidAvatarId,
  getKidIllustratedAvatar,
  isKidIllustratedAvatarId,
} from '@/src/lib/avatars';

type Props = {
  id?: string | null;
  size?: number;
  radius?: number;
};

export default function Avatar({ id, size = 56, radius }: Props) {
  const r = radius ?? size / 2;

  if (isKidIllustratedAvatarId(id)) {
    const a = getKidIllustratedAvatar(id);
    return (
      <View style={[styles.wrap, { width: size, height: size, borderRadius: r }]}>
        <Image source={a.image} style={{ width: size, height: size }} contentFit="cover" />
      </View>
    );
  }

  if (isKidAvatarId(id)) {
    const a = getKidAvatar(id);
    return (
      <View
        style={[
          styles.wrap,
          styles.kidWrap,
          { width: size, height: size, borderRadius: r, backgroundColor: a.color },
        ]}
      >
        <Ionicons name={a.icon as any} size={Math.round(size * 0.56)} color="#fff" />
      </View>
    );
  }

  const a = getAvatar(id);
  return (
    <View style={[styles.wrap, { width: size, height: size, borderRadius: r }]}>
      <Image source={a.image} style={{ width: size, height: size }} contentFit="cover" />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { overflow: 'hidden' },
  kidWrap: { alignItems: 'center', justifyContent: 'center' },
});
