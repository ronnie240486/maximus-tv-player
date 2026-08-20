# Maximus Player TV Box

Projeto-fonte do Maximus Player com a correção do fluxo de canais ao vivo. O mini player e o player grande usam uma única sessão de reprodução LIVE e uma única `VideoView` global; ao expandir ou fechar o player, a transmissão não deve ser recarregada nem perder posição e buffer.

## O que foi corrigido

A tela de Canais não mantém mais uma segunda superfície de vídeo quando o player grande é aberto. A sessão global preserva a fonte efetiva, inclusive fallback `.ts`, posição, buffer e estado de reprodução. A tela grande não chama `replace`, `prepare` ou `play` novamente quando o canal já está ativo no mini player. Trocas concorrentes antigas não podem sobrescrever o canal atual.

Filmes e séries não são alterados por essa correção; a limpeza específica separa fontes `live` e `vod`.

## Build pelo EAS sem GitHub

O projeto pode ser compilado localmente com o EAS CLI:

```bash
yarn install
npx eas-cli login
npx eas-cli build:configure
npx eas-cli build --platform android --profile preview
```

O projeto também pode ser conectado ao EAS Studio a partir deste repositório privado. O build deve ser feito a partir desta pasta, que contém `package.json`, `app.json`, `eas.json`, `app/` e `src/`. Não inclua `node_modules`, SDK Android ou builds locais.

## Teste obrigatório do player

Após instalar a APK, abra um canal e assista por alguns minutos. Abra o player grande, aguarde pelo menos dez minutos, volte ao mini player e confirme que o vídeo continua no mesmo ponto. Repita a abertura e o fechamento e depois troque para outro canal. O canal não deve reiniciar, atrasar ou apresentar dois áudios/vídeos simultâneos.

## Observação sobre a APK

A APK corrigida deve ser gerada pelo build nativo completo do EAS/Android Studio. Não substitua apenas o bundle Hermes dentro de um APK antigo, porque isso pode causar incompatibilidade entre o JavaScript e os módulos nativos.
