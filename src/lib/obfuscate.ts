// Ofuscação leve pra endereços de servidor "hardcoded" no app (painel,
// gerador de teste). NÃO é criptografia de verdade nem impede engenharia
// reversa séria (quem decompilar o bytecode Hermes consegue rodar essa
// mesma função e ver o resultado) — só evita que um "strings arquivo.apk"
// simples devolva o link de bandeja, dificultando a cópia mais trivial.
//
// Implementação manual (sem `atob`/`Buffer`) porque nem todo motor JS do
// React Native garante `atob` global — mesmo padrão já usado em
// `src/lib/xtream.ts` pra decodificar texto de EPG.
const B64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=';

export function decodeB64(input: string): string {
  try {
    const str = input.replace(/[^A-Za-z0-9+/=]/g, '');
    let output = '';
    for (let i = 0; i < str.length; i += 4) {
      const enc1 = B64_CHARS.indexOf(str[i]);
      const enc2 = B64_CHARS.indexOf(str[i + 1]);
      const enc3 = B64_CHARS.indexOf(str[i + 2]);
      const enc4 = B64_CHARS.indexOf(str[i + 3]);
      const chr1 = (enc1 << 2) | (enc2 >> 4);
      const chr2 = ((enc2 & 15) << 4) | (enc3 >> 2);
      const chr3 = ((enc3 & 3) << 6) | enc4;
      output += String.fromCharCode(chr1);
      if (enc3 !== 64 && enc3 !== -1) output += String.fromCharCode(chr2);
      if (enc4 !== 64 && enc4 !== -1) output += String.fromCharCode(chr3);
    }
    return output;
  } catch {
    return '';
  }
}
