// Qual perfil está sendo usado agora. Guardado em memória (não precisa
// persistir — a pessoa sempre passa pela tela de perfis de novo ao abrir o
// app). Os módulos de dados pessoais (favoritos, continuar assistindo,
// lembretes) usam isso pra prefixar suas chaves de armazenamento, assim
// cada perfil só vê o próprio conteúdo salvo — sem isso, dois perfis no
// mesmo aparelho estariam compartilhando favoritos/histórico sem querer.

let activeProfileId: string | null = null;

export function setActiveProfileId(id: string | null): void {
  activeProfileId = id;
}

export function getActiveProfileId(): string {
  // Fallback fixo pra quem ainda não tem perfil selecionado (ou versões
  // antigas do app sem seleção de perfil) — assim os dados antigos salvos
  // antes dessa mudança não se perdem.
  return activeProfileId || 'default';
}
