// 35 avatar photos bundled locally (assets/images/avatars/avatar-1.jpg .. 35)
// so picking an avatar never needs a network request. Metro requires static
// `require()` calls (no dynamic paths), hence the explicit array below.
export type AvatarStyle = {
  id: string;
  image: number; // require() result
};

/* eslint-disable global-require */
const IMAGES: number[] = [
  require('../../assets/images/avatars/avatar-1.jpg'),
  require('../../assets/images/avatars/avatar-2.jpg'),
  require('../../assets/images/avatars/avatar-3.jpg'),
  require('../../assets/images/avatars/avatar-4.jpg'),
  require('../../assets/images/avatars/avatar-5.jpg'),
  require('../../assets/images/avatars/avatar-6.jpg'),
  require('../../assets/images/avatars/avatar-7.jpg'),
  require('../../assets/images/avatars/avatar-8.jpg'),
  require('../../assets/images/avatars/avatar-9.jpg'),
  require('../../assets/images/avatars/avatar-10.jpg'),
  require('../../assets/images/avatars/avatar-11.jpg'),
  require('../../assets/images/avatars/avatar-12.jpg'),
  require('../../assets/images/avatars/avatar-13.jpg'),
  require('../../assets/images/avatars/avatar-14.jpg'),
  require('../../assets/images/avatars/avatar-15.jpg'),
  require('../../assets/images/avatars/avatar-16.jpg'),
  require('../../assets/images/avatars/avatar-17.jpg'),
  require('../../assets/images/avatars/avatar-18.jpg'),
  require('../../assets/images/avatars/avatar-19.jpg'),
  require('../../assets/images/avatars/avatar-20.jpg'),
  require('../../assets/images/avatars/avatar-21.jpg'),
  require('../../assets/images/avatars/avatar-22.jpg'),
  require('../../assets/images/avatars/avatar-23.jpg'),
  require('../../assets/images/avatars/avatar-24.jpg'),
  require('../../assets/images/avatars/avatar-25.jpg'),
  require('../../assets/images/avatars/avatar-26.jpg'),
  require('../../assets/images/avatars/avatar-27.jpg'),
  require('../../assets/images/avatars/avatar-28.jpg'),
  require('../../assets/images/avatars/avatar-29.jpg'),
  require('../../assets/images/avatars/avatar-30.jpg'),
  require('../../assets/images/avatars/avatar-31.jpg'),
  require('../../assets/images/avatars/avatar-32.jpg'),
  require('../../assets/images/avatars/avatar-33.jpg'),
  require('../../assets/images/avatars/avatar-34.jpg'),
  require('../../assets/images/avatars/avatar-35.jpg'),
];
/* eslint-enable global-require */

// Same id scheme as before (avatar_1..avatar_N) so any profile a person
// already picked (avatar_1..avatar_8) keeps working — it just now resolves
// to a real photo instead of a colored circle+letter.
export const AVATARS: AvatarStyle[] = IMAGES.map((image, i) => ({
  id: `avatar_${i + 1}`,
  image,
}));

export function getAvatar(id?: string | null): AvatarStyle {
  if (!id) return AVATARS[0];
  return AVATARS.find((a) => a.id === id) || AVATARS[0];
}

// Avatares do perfil infantil: ícone + cor de fundo, em vez das fotos
// usadas nos perfis normais — não precisa de nenhuma imagem nova, e fica
// visualmente bem diferente (mais lúdico, menos "foto de gente").
export type KidAvatarStyle = { id: string; icon: string; color: string };

export const KIDS_AVATARS: KidAvatarStyle[] = [
  { id: 'kid_1', icon: 'rocket', color: '#FF6B6B' },
  { id: 'kid_2', icon: 'paw', color: '#4ECDC4' },
  { id: 'kid_3', icon: 'balloon', color: '#FFD93D' },
  { id: 'kid_4', icon: 'ice-cream', color: '#FF8FB1' },
  { id: 'kid_5', icon: 'football', color: '#6BCB77' },
  { id: 'kid_6', icon: 'star', color: '#845EC2' },
  { id: 'kid_7', icon: 'happy', color: '#FFA45B' },
  { id: 'kid_8', icon: 'fish', color: '#4D96FF' },
  { id: 'kid_9', icon: 'flower', color: '#FF66C4' },
  { id: 'kid_10', icon: 'game-controller', color: '#00C2A8' },
  { id: 'kid_11', icon: 'sunny', color: '#FFC93C' },
  { id: 'kid_12', icon: 'planet', color: '#7A5CFA' },
];

export function isKidAvatarId(id?: string | null): boolean {
  return !!id && id.startsWith('kid_');
}

export function getKidAvatar(id?: string | null): KidAvatarStyle {
  if (!id) return KIDS_AVATARS[0];
  return KIDS_AVATARS.find((a) => a.id === id) || KIDS_AVATARS[0];
}

// Avatares infantis ilustrados (imagem de verdade, estilo desenho/anime
// fantasia) — mesmo padrão do AVATARS normal, mas numa pasta própria.
// Diferente dos ícones acima (kid_N), esses usam o prefixo kidart_N.
/* eslint-disable global-require */
const KID_ILLUSTRATED_IMAGES: number[] = [
  require('../../assets/images/kid-avatars/kid-avatar-1.jpg'),
  require('../../assets/images/kid-avatars/kid-avatar-2.jpg'),
  require('../../assets/images/kid-avatars/kid-avatar-3.jpg'),
  require('../../assets/images/kid-avatars/kid-avatar-4.jpg'),
  require('../../assets/images/kid-avatars/kid-avatar-5.jpg'),
  require('../../assets/images/kid-avatars/kid-avatar-6.jpg'),
  require('../../assets/images/kid-avatars/kid-avatar-7.jpg'),
];
/* eslint-enable global-require */

export const KIDS_ILLUSTRATED_AVATARS: AvatarStyle[] = KID_ILLUSTRATED_IMAGES.map((image, i) => ({
  id: `kidart_${i + 1}`,
  image,
}));

export function isKidIllustratedAvatarId(id?: string | null): boolean {
  return !!id && id.startsWith('kidart_');
}

export function getKidIllustratedAvatar(id?: string | null): AvatarStyle {
  return KIDS_ILLUSTRATED_AVATARS.find((a) => a.id === id) || KIDS_ILLUSTRATED_AVATARS[0];
}
