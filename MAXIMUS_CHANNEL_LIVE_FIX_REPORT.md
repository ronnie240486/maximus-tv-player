# Correção de reprodução dos canais ao vivo

## Escopo

Esta alteração trata exclusivamente o fluxo de canais ao vivo. Filmes e séries não foram alterados pela lógica de reprodução LIVE.

## Correções aplicadas

O projeto agora mantém uma única instância do `expo-video` dentro de `PlayerSessionProvider` e uma única `VideoView` global. O mini player e a tela grande não montam superfícies concorrentes; o host global apenas muda de posição e tamanho.

A sessão distingue fontes `live` e `vod`. Ao mudar de filme/série para canal, a fonte anterior é pausada e limpa antes da preparação LIVE. Dentro do mesmo canal, uma chamada com a mesma URI e o mesmo tipo não executa `replaceAsync` novamente.

As trocas concorrentes recebem um identificador de requisição. Uma resposta antiga não pode executar `play` nem recolocar uma fonte depois que outra troca foi iniciada. O fallback HLS/TS continua limitado ao fluxo LIVE.

A tela de Canais mede o retângulo do preview e informa essa posição ao host global. O player grande usa a mesma sessão, posição e buffer; abrir ou fechar a rota não deve recarregar o canal.

## Validação

A exportação do bundle Android foi concluída. O TypeScript não apresenta erros novos em `player-session.tsx`, `TVChannelPreview.tsx`, `player.tsx` ou `_layout.tsx`; permanece um erro antigo e não relacionado em `channels.tsx` sobre `columnWrapperStyle` do FlashList.

A APK nativa ainda não foi gerada neste ambiente. Não foi aplicada substituição parcial de bundle em APK existente para evitar os crashes observados anteriormente. A compilação final deve ser feita com o projeto nativo completo, incluindo CMake/NDK e New Architecture.
