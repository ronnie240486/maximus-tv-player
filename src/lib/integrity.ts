// Verificação de integridade do app — dificulta (não elimina, isso não
// existe) que alguém pegue esse APK, troque nome/ícone/pacote e resuba
// como se fosse um app próprio.
//
// O QUE ISSO PROTEGE: se alguém descompilar o APK, mudar o
// `applicationId` (obrigatório pra republicar sem conflitar com o
// original) e reempacotar, o app se recusa a abrir.
//
// O QUE ISSO NÃO PROTEGE: uma cópia BIT A BIT do mesmo APK, reassinada
// mas com o MESMO applicationId, passa por essa checagem (o pacote é
// idêntico). Pra pegar esse caso também, precisaria conferir o hash da
// assinatura (certificado) em código nativo — mais forte, mas exige um
// módulo nativo Kotlin e um build de teste no EAS pra validar antes de
// confiar nele em produção. Se quiser essa camada extra depois, é um
// próximo passo separado.
import { Platform } from 'react-native';
import * as Application from 'expo-application';

// Tem que bater exatamente com android.package / ios.bundleIdentifier
// no app.json. Se alguém clonar e mudar isso pra publicar como outro
// app, a checagem abaixo falha.
const EXPECTED_APP_ID = 'com.interactiveplayer.app';

export type IntegrityResult = {
  ok: boolean;
  reason?: 'package_mismatch';
};

export function verifyAppIntegrity(): IntegrityResult {
  // Web (preview no navegador) não tem applicationId de verdade — não
  // faz sentido bloquear aí, essa checagem só importa pro APK final.
  if (Platform.OS === 'web') return { ok: true };

  const appId = Application.applicationId;
  if (appId && appId !== EXPECTED_APP_ID) {
    return { ok: false, reason: 'package_mismatch' };
  }
  return { ok: true };
}
