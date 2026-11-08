# Google Ads na landing pública

O bootstrap continua usando o snippet padrão do Google: `dataLayer`, `gtag('js', new Date())`
e `gtag('config', ID)`, pelo componente `GoogleAnalytics` do Next. O ID permanece no `.env`.

## Ajustes da revisão

- Nonce da CSP repassado aos scripts de inicialização e ao SDK; em navegações do cliente,
  usa-se o nonce do documento que está aberto.
- Consent Mode preparado antes de `js/config`, sem depender de temporizadores. A tag só
  carrega após aceite explícito, conforme o comportamento já definido para a landing.
- Recusa/revogação enviada ao Google imediatamente; preferências sincronizadas entre abas.
  Se o navegador bloquear o armazenamento, a escolha vale no documento atual.
- Destinos `pagead2.googlesyndication.com` e `ad.doubleclick.net` liberados nas diretivas
  correspondentes da CSP, mantendo `nonce` e `strict-dynamic`.
- Links da landing para gestão/portal carregam um novo documento. Isso encerra a execução
  do SDK público antes de entrar nas áreas autenticadas.
- Build args do release candidate alinhados ao Compose principal.
- IDs vazios ou fora do formato `AW-` seguido de dígitos desativam a integração.

## Configuração

No `.env` da raiz, usado pelo Docker Compose:

```dotenv
NEXT_PUBLIC_GOOGLE_ADS_ID=AW-809397759
NEXT_PUBLIC_GOOGLE_ADS_WHATSAPP_LABEL=
```

O ID é público. Não substitui uma label de conversão. Para medir o clique no WhatsApp,
copie do snippet de evento a parte após a barra em `send_to: 'AW-809397759/LABEL'` para
`NEXT_PUBLIC_GOOGLE_ADS_WHATSAPP_LABEL`. Use o código fornecido pelo Google, e não o
nome da ação, como “Contato”. Com label vazia, a tag base funciona após o aceite,
mas o clique não dispara conversão. A conversão implementada mede o clique no link;
não confirma mensagem enviada, atendimento iniciado ou venda.

As variáveis `NEXT_PUBLIC_*` são incorporadas ao build. Depois de editar o `.env`:

```sh
docker compose build frontend
docker compose up -d frontend
```

Para executar Next diretamente na pasta `frontend`, configure essas mesmas variáveis
em `frontend/.env.local` ou no ambiente do processo. Next não lê automaticamente o
`.env` da raiz ao executar nessa subpasta.

## Verificação

`node --test frontend/test/google-ads.test.mjs` verifica consentimento, revogação,
armazenamento bloqueado, inicialização única, configuração opcional e destino da conversão.
O teste também foi incluído no job de frontend do release candidate.

Validação local realizada: 13 testes aprovados, TypeScript sem erros e build de produção
concluído. No Chrome com esse build, foram conferidos o bloqueio antes do aceite, o nonce
dos scripts e a ausência de violações de CSP para scripts, a ordem consentimento/config,
a revogação, a sincronização entre abas, o armazenamento bloqueado e os acessos às três
telas de login sem a tag. O SDK externo foi interceptado com uma resposta simulada;
essa verificação não enviou eventos ao Google. Com label vazia, o WhatsApp abriu normalmente
sem enfileirar conversão. Revogar e aceitar novamente não duplicou o SDK nem o config.

No ambiente publicado, confirme no [Tag Assistant](https://tagassistant.google.com/)
o ID, a ordem de consentimento e o evento de WhatsApp com a label da conta. Isso exige
a configuração real da ação no Google Ads; testes locais não comprovam atribuição a anúncios
nem a contabilização no painel.

Referências oficiais: [tag e conversões do Google Ads](https://support.google.com/google-ads/answer/7548399?hl=en),
[Consent Mode](https://developers.google.com/tag-platform/security/guides/consent),
[CSP para Google Ads](https://developers.google.com/tag-platform/security/guides/csp#google_ads).
