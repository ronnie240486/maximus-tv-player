// Controla se esse dispositivo já usou o teste gratuito, pra impedir gente
// gerando teste várias vezes só recarregando o app. MACs que já estão
// cadastrados no painel do revendedor (registered: true) NUNCA são
// bloqueados por essa checagem — são clientes conhecidos, não abuso.
//
// Isso é uma trava só do lado do celular (não existe controle nenhum do
// nosso lado no servidor que gera o teste) — alguém decidido a burlar
// pode limpar os dados do app ou reinstalar. Não é uma segurança à prova
// de tudo, é só um freio razoável pro uso comum.
import { storage } from '@/src/utils/storage';

const KEY_PREFIX = 'test_used_v1_';

export async function hasUsedTest(mac: string): Promise<boolean> {
  try {
    return !!(await storage.getItem<boolean>(KEY_PREFIX + mac, false));
  } catch {
    return false;
  }
}

export async function markTestUsed(mac: string): Promise<void> {
  await storage.setItem(KEY_PREFIX + mac, true);
}
