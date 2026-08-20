import React, { useState } from 'react';
import { Pressable, PressableProps, StyleSheet, ViewStyle, StyleProp } from 'react-native';
import { colors } from '@/src/theme';
import { useIsTV } from '@/src/hooks/useIsTV';

type Props = Omit<PressableProps, 'style'> & {
  style?: StyleProp<ViewStyle>;
  /** Estilo aplicado só quando o item está em foco numa TV. Se omitido,
   * usa um contorno ciano + leve zoom, que já cobre a maioria dos casos. */
  focusStyle?: StyleProp<ViewStyle>;
  /** Node handle (de findNodeHandle) de outro elemento focável — diz pro
   * Android TV "quando apertar ESQUERDA aqui, vai direto pra esse
   * elemento", em vez de deixar o algoritmo espacial padrão decidir.
   * Android apenas; sem efeito no celular. */
  nextFocusLeft?: number;
  nextFocusRight?: number;
  nextFocusUp?: number;
  nextFocusDown?: number;
};

/**
 * Wrapper fino em volta do Pressable que dá destaque visual quando o item
 * recebe foco via D-pad/controle remoto numa TV box.
 *
 * Em Android, qualquer View com onPress já é focável e navegável por D-pad
 * automaticamente — o que falta por padrão é o FEEDBACK visual de "isso
 * está selecionado agora", que é essencial pra quem está usando controle
 * remoto (sem cursor, sem toque). Este componente resolve isso sem exigir
 * mudança nenhuma em quem já usa <Pressable>: é só trocar o import.
 *
 * No celular (isTV === false), se comporta como um Pressable comum, sem
 * nenhum overhead visual.
 */
const TVFocusable = React.forwardRef<React.ElementRef<typeof Pressable>, Props>(
  ({ style, focusStyle, onFocus, onBlur, nextFocusLeft, nextFocusRight, nextFocusUp, nextFocusDown, ...rest }, ref) => {
    const isTV = useIsTV();
    const [focused, setFocused] = useState(false);

    return (
      <Pressable
        ref={ref}
        {...rest}
        {...{ nextFocusLeft, nextFocusRight, nextFocusUp, nextFocusDown }}
        focusable
        onFocus={(e) => {
          setFocused(true);
          onFocus?.(e);
        }}
        onBlur={(e) => {
          setFocused(false);
          onBlur?.(e);
        }}
        style={[style, isTV && focused && (focusStyle || styles.defaultFocus)]}
      />
    );
  }
);

export default TVFocusable;

const styles = StyleSheet.create({
  defaultFocus: {
    borderWidth: 2,
    borderColor: colors.accentCyan,
  },
});
