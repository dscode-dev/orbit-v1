# ARCHITECTURE — Frontend

## Três fronteiras de sessão

```text
/login           → platform → OWNER/MANAGER
/operator/login  → operator → OWNER/OPERATOR
/customer/login  → customer → CustomerPortalAccount
```

`AppProviders` escolhe o provider pelo segmento completo. O client usa refresh de cliente somente
no scope `customer`. A Central recebe prefill do backend e reutiliza `OperationCreationDrawer`;
atribuição, relacionamentos e transação continuam no backend.

## Datas-calendário e dados operacionais de endereço

- Campos PMOC que representam um dia, sem horário, são formatados com `timeZone: "UTC"`.
- Timestamps reais continuam usando o timezone local; as duas semânticas não são misturadas.
- Complemento e ponto de referência vêm da relação `Operation.address` e são somente informativos
  no Operator. Nenhuma regra documental foi duplicada no frontend.

## Projeções operacionais e snapshots comerciais

- PMOC consome a projeção por equipamento do backend, sem recompor estado pelas Execution Requests.
- `BudgetItem.source` discrimina conteúdo informativo e comercial; texto e preço zero não inferem
  origem.
- O catálogo permanece fonte de entrada e Budget permanece proprietário do snapshot.

## Catálogos como fonte de entrada, snapshots como histórico

`EQUIPMENT_TYPE` mantém relação com Equipment porque representa classificação cadastral durável.
`BUDGET_MATERIAL_DESCRIPTION` apenas acelera a entrada: Budget continua proprietário de seus itens
e snapshots. Ambos reutilizam API, RBAC, paginação e Drawer do catálogo oficial.

## Dados operacionais da OS

`serviceValue` permanece no agregado Operation. O frontend não o encaminha para componentes do
Document Engine. A Platform coleta; o Operator autorizado visualiza.

A complementação de equipamentos utiliza `inspectedEquipments` da própria Operation, sem criar
endpoint ou cadastro paralelo. O backend decide ownership e persiste somente campos ausentes.

## Projeção PMOC

Periodicidade, capacidade, numeração e encerramento são autoritativos no backend.
`executionNumber` permanece histórico; `equipmentExecutionNumber` é apresentado ao usuário.

## Separação PMOC Plan × execução

`PmocPlanWizard(configurationOnly)` é uma variação do componente oficial. A Platform persiste o
plano; `PmocExecutionRequest`, `Operation`, `Assignment` e Document Engine continuam no fluxo
operacional posterior. As datas do formulário são projeções e não criam registros.

## Cliente 360

```text
/clientes/:id
├── operations/stats?customerId → KPIs
├── operations?customerId → recentes + Serviços
├── customers/:id/contacts → CRUD de contatos
└── OperationCreationDrawer(customerId locked) → Operation oficial
```

KPIs são agregados no PostgreSQL/backend e não derivados da paginação. O drawer contextual apenas
fixa a seleção visual; autorização e integridade continuam no domínio Operation.

## Recibo originado por venda

```text
Sale COMPLETED
→ receipt-prefill (cliente + documento + snapshots)
→ declaração automática sensível à origem
→ Operation RECEIPT com sourceSaleId
→ DocumentContext
→ Blueprint → Preview/PDF
```

O formulário não consulta Product/Pricing e não reconstitui a venda. A declaração automática é
editável, mas depois de persistida torna-se snapshot documental.

## Geração operacional a partir do PMOC

```text
PmocPlan
→ PmocExecutionRequest PENDING
→ prefill autoritativo
→ OperationCreationDrawer (revisão)
→ generate-work-order
→ Operation + Assignment + MaintenanceExecution
→ Operator
```

Selecionar a origem nunca persiste dados. O frontend não reconstrói a cobertura nem cria a
Operation diretamente; apenas revisa campos permitidos. A materialização do checklist por
equipamento e as validações de vínculo permanecem no backend.

## Fonte única de checklist

`TechnicalCatalog(CHECKLIST) → wizard RVT/PMOC → Operation snapshot → DocumentContext → DocumentBuilder → Preview/PDF`.

O frontend não reconstrói checklist durante renderização. RVT envia grupos estruturados; PMOC envia referências e a decisão de herança.

## Projeção gerencial de operadores

`Platform → operatorExecutionsApi → OperatorExecutionsService → Assignment + Operation`. O frontend apenas formata indicadores calculados pelo backend. Não há store persistente, dataset local, regra de comissão ou interpretação de ownership; `Assignment.assignedTo` permanece autoritativo.

A fronteira dos aplicativos é segment-aware: somente o segmento exato `/operator` e seus descendentes usam o escopo mobile. Rotas Platform como `/operator-executions` não podem herdar providers ou sessão do Operator por coincidência de prefixo.

## Operator — conclusão documental

O frontend não gera PDF nem altera estados por conta própria. Ele encadeia os contratos oficiais `Operation → Assignment → Handoff → Document Engine`. A política visual separa OS/RVT de documentos especiais, mas o backend revalida tipo, ownership e estado em cada transição. A recuperação de emissão reutiliza o mesmo `OperationDocument` e o mesmo `DocumentViewer`.

## PMOC — precondição orientada pelo backend

O frontend realiza uma consulta preventiva para boa UX, mas não replica a regra de cobertura. O `POST /pmoc` revalida a condição e pode responder `409`; o cliente então solicita confirmação e repete a chamada com o override explícito. Isso preserva consistência em concorrência e evita que a UI se torne autoridade de negócio.

## DC-05 — arquitetura do Recibo

O frontend coleta snapshots e orquestra APIs oficiais. `currency-words.ts` converte o valor para
texto pt-BR como conveniência editável, sem calcular preço. Blueprint, assinatura e PDF permanecem
exclusivamente no backend Document Engine.


## PMOC — ownership dos artefatos de campo

- `PmocPlan` mantém configuração e responsável técnico; `Operation` mantém fotos; o Handoff do
  `OperationDocument` mantém a assinatura do cliente e o coletor. Não existe estado persistente
  concorrente no wizard.
- Em criação, artefatos ficam apenas em memória e forçam a criação da primeira execução/OS antes de
  persistir. Em edição, a execução mais recente é a fonte autoritativa.
- Platform e Operator usam os mesmos endpoints e o mesmo preview autenticado de assinatura.

## PMOC UX-02.1

- A cadeia permanece `PmocPlan → ExecutionRequest → Operation → Assignment → MaintenanceExecution →
  DocumentContext → Builder → Blueprint → Renderer → PdfEngine → Storage → /documentos`.
- Fotos e assinaturas são gravadas somente na Operation; Platform e Operator compartilham os mesmos
  contratos e componentes, sem estado persistente paralelo.
- O frontend apenas representa `signatureMode`, `signedAt` e contagem retornados. Template e backend
  são autoridades de política, mínimo de evidências, transições e stale detection.
- PDF é transportado como Blob autenticado; object URL é temporária e revogada após uso.

## PMOC UX-02

- O browser não persiste agenda nem títulos de escopo: envia IDs de catálogo e solicita
  reagendamento de uma Execution Request oficial.
- A sugestão de nome é auxiliar; quando não editada, o frontend omite `name` e delega ao backend o
  número definitivo, evitando divergência concorrente.
- O Wizard apenas orquestra APIs existentes. A cadeia permanece `PmocPlan → ExecutionRequest →
  Operation → Assignment → MaintenanceExecution → Document Engine`.
- Política de assinatura continua vindo de `DocumentConfiguration`; nenhum modo é decidido no UI.

## PMOC Foundation — Bloco 3

```text
GET /pmoc/stats ──→ cards + calendário + próximas/últimas
GET /pmoc/:id ───→ overview + contexto operacional
GET /pmoc/:id/execution-requests ──→ tabela server-side paginada
GET /pmoc/:id/history ──→ timeline append-only consolidada
```

O frontend não calcula saúde, conformidade, atraso, progresso ou status visual. O calendário é uma
view das Execution Requests e não persiste evento. Cliente, Equipamento e Operator reutilizam as
mesmas projeções PMOC, mantendo Operation/Assignment/MaintenanceExecution como fontes operacionais.

## PMOC Foundation — Bloco 2

```text
PmocPlanWizard
→ PMOC + MaintenancePlan + Execution Request oficiais
→ prefill da request
→ OperationCreationDrawer
→ Operations + Assignment + MaintenanceExecution existentes
→ Document Engine existente
```

O cliente não calcula sequência, recorrência ou projeções persistidas. A responsabilidade de cada
execução vem dos snapshots da API; defaults atualizados só são propagados quando o usuário confirma
e o backend autoriza. A timeline é o histórico append-only retornado pelo PMOC, e o Operator apenas
projeta o contexto recebido na Assignment/Operation.

`/pmoc` substitui a criação PMOC embutida na Central de Relatórios. Isso mantém um único domínio de
planejamento e deixa `/reports` responsável apenas por documentos.

## PMOC execution identity

`executionNumber` vem da API e nunca é calculado no cliente. `operation.number` representa a OS e
não substitui a execução PMOC. Campos `last*`, `next*` e scheduler são projeções read-only; a
Platform mantém o mesmo wizard e não persiste estado operacional paralelo.

## PMOC Foundation

Fluxo único: `pmocApi prefill → OperationCreationDrawer → pmocApi.generateWorkOrder → Operation`.
O frontend não cria `MaintenanceExecution`, não liga Operation, não calcula recorrência e não produz
documento. Scheduler, transação, histórico e Document Engine permanecem no backend.

## DC-03.1 — snapshots autorais do Laudo

O wizard persiste `technicalOpinionResponsible`, `technicalOpinionCrea` e os campos
`systemType/currentSituation` de cada equipamento na Operation. A Platform não combina dados do
cliente nem monta tabela: DocumentContext e Builder produzem o Blueprint único para Preview/PDF.

## DC-03

```text
Central de Relatórios
→ Operation com campos technicalOpinion* + inspectedEquipments
→ DocumentViewer
→ DocumentContext
→ DocumentBuilder
→ mesmo DocumentBlueprint
├─ Preview
└─ Renderer → PdfEngine → Download
```

O frontend não interpreta política de assinatura, não monta seções do Laudo e não reutiliza o
conteúdo do Relatório de Visita. A quebra visual de células é uma projeção genérica do contrato de
tabela, sem regra local de `TECHNICAL_OPINION`.

O Builder backend decide que `WORK_ORDER` contém somente `Código QR` no metadata. O Viewer não
interpreta o tipo documental nem recria a imagem, preservando a arquitetura Blueprint-driven.

O cabeçalho em duas linhas é uma projeção do `header` do Blueprint; a ordem das seções e a decisão
de omitir QR/documentos relacionados pertencem ao Builder backend. O frontend não replica essas
regras e apenas preserva a ordem recebida.

`DocumentViewer` continua consumindo o Blueprint oficial. A versão raiz é metadado de integração e
não conteúdo visual; header e footer são apresentados sem composição documental paralela.

## DC-02

```text
Central de Relatórios
→ POST/PATCH Operation (conteúdo técnico)
→ DocumentViewer
→ Document Engine Preview/Render/Download
→ mesmo DocumentBlueprint no Viewer e no PDF
→ GET /documents
```

A paginação do Viewer é apenas uma projeção visual dos componentes e das orientações de quebra do
Blueprint; não contém regra de negócio ou template de `TECHNICAL_REPORT`. A composição semântica
permanece no Builder e a paginação definitiva no LayoutEngine/Renderer.

## Product Backlog Closure 07

`ReportWorkflowDrawer → Operation/MaintenanceExecution → configuração por tipo → DocumentViewer → Preview/Render/Download → GET /documents`.

O wizard apenas orquestra domínios oficiais. Não possui renderer, PDF engine, template local, política local de assinatura ou repositório próprio.

## DC-01.2

Orientações de paginação permanecem no Blueprint/LayoutEngine; o frontend não introduz regras
específicas para a Ordem de Serviço.

`DocumentVisualStyle` é um contrato aditivo do Blueprint e não uma folha de estilo documental
paralela. O Viewer traduz os mesmos tokens e componentes consumidos pelo Renderer PDF. QR e
assinaturas chegam como assets resolvidos pelo backend; o frontend não acessa Storage, não gera QR
e não interpreta a política do template.

## DC-01

A especialização visual/semântica da OS reside no DocumentBuilder. O frontend apenas captura campos
da Operation e representa o Blueprint oficial no DocumentViewer; não possui template local de OS.

## Document Engine D1

`GET /documents` é o read model documental oficial. O frontend não agrega Operations, Budgets ou
snapshots. `DocumentViewer` permanece a fronteira única para Blueprint, render e download.
TemplateFormDrawer envia políticas e IDs; resolução, autorização e assets permanecem no backend.

## Product Backlog Closure 05 — document preview architecture

Arquitetura preservada:

```text
Reports
↓
DocumentViewer
↓
Document Engine API
↓
Blueprint oficial
↓
Preview / Render / Download
```

Decisões:

- Preview de modelo e preview de dados reais são fluxos semanticamente diferentes, mas usam o mesmo
  viewer.
- O frontend não monta documentos e não acessa assinatura de Operation diretamente.
- Preview e PDF devem divergir apenas quando o backend emitir novo blueprint/render; após render,
  `renderMetadata` contém proveniência (`sourceKind`, `sourceId`, `templateId`).

## Product Backlog Closure 05.1 — Platform visit workflow architecture

`/reports/visita` segue a arquitetura oficial:

```text
Platform Visit Evidence UI
↓
PATCH /operations/:id
↓
Operation + OperationPhoto + StorageProvider
↓
DocumentContext
↓
DocumentBuilder
↓
DocumentBlueprint
├─ DocumentViewer
└─ PDF Engine
```

Decisões:

- não existe `VisitReport` frontend/domain;
- fotos não são armazenadas como object URLs;
- assinatura não é anexada manualmente ao preview;
- PDF não é gerado no frontend.

## Sprint 23 — V1 product workflow closure

Sprint 23 preserva a arquitetura oficial:

```text
Operator PWA
↓
Assignments API
↓
Operation context
├─ Inventory API para materiais
├─ DocumentViewer / Document Engine para documentos
└─ Assignment history para timeline de execução
```

Decisões:

- O Operator PWA não monta workflows paralelos; ele atua sobre Assignment e Operation.
- Consumo de material continua passando por Inventory e `OperationPart`; o frontend não calcula
  saldo autoritativo.
- Documentos continuam passando por `DocumentViewer`; não existe geração local de PDF.
- Cards de capacidades ainda não finalizadas foram rebaixados para informação clara, evitando CTAs
  mortos.
- Nenhum state manager, cache global, domínio novo ou infraestrutura offline foi introduzido.

## Sprint 21 — Performance architecture review

Sprint 21 confirmou a arquitetura de consumo real:

```text
UI paginada / drawers / dashboard
↓
packages/api
↓
Backend paginado + Document Engine + Asset Lifecycle
```

Decisões:

- o frontend não deve criar caches globais persistentes de domínio para "ganhar performance";
- performance deve vir de paginação, filtros cumulativos, abort de requests obsoletas e componentes
  únicos reutilizáveis;
- o dashboard executivo atual permanece fan-out porque o backend medido ficou dentro do budget;
- se staging ou usuários reais apontarem gargalo, a próxima ação correta é endpoint agregado no
  backend, não cálculo local duplicado;
- rotas administrativas grandes devem ser otimizadas por code splitting de componentes pesados,
  preservando contratos e RBAC.

Riscos classificados:

- Sprint 22: avaliar lazy-load interno em `/equipamentos`, principalmente drawers/document viewer;
- Sprint 23: revisar `/budgets` e `/produtos` se métricas reais indicarem impacto;
- Post-V1 Optimization: introduzir bundle analyzer dedicado e budgets automatizados no CI.

## Frontend Sprint 9 — Architecture Inspection & Creation Flow Consolidation

Criações operacionais foram consolidadas sobre um único fluxo:

```text
Agenda / Operações / Serviços / OS
↓
OperationCreationDrawer
↓
operationApi.createOperation
↓
Backend Operation + OS rascunho
```

Decisões:

- não criar domínio `Service` paralelo no frontend;
- não criar OS isolada no frontend;
- Agenda usa Operation agendada enquanto não existir endpoint dedicado de agenda;
- selects reutilizáveis ficam em `apps/platform/components/entity-select.tsx`;
- `OperationCreationDrawer` concentra validação, stepper, loading, erro, sucesso e confirmação;
- RBAC visual continua via `<Gate>` e backend continua a fronteira real de autorização.

Limitação de contrato:

- `CreateOperationDto` do backend atual não aceita `operatorId` e usa o ator autenticado como
  operador. A UI já possui `UserSelect`, mas não envia `operatorId` para evitar erro
  `forbidNonWhitelisted`. A delegação real deve ser implementada em contrato backend futuro.

## Frontend Sprint 8 — Inventory, Materials & Pricing

Integração adicionada sem alterar backend:

```text
packages/api/inventory.ts
packages/api/pricing.ts
↓
app/(platform)/produtos
OperationDetailDrawer
Dashboard
```

Decisões:

- `Product` continua representando catálogo técnico; a UI não adiciona preço no produto.
- `InventoryItem` continua representando estoque físico; a UI não adiciona custo no estoque.
- `ProductPricing` é consumido exclusivamente por `pricingApi`.
- saldo físico nunca é alterado por edição direta; a UI registra `StockMovement`.
- consumo de materiais em Operation é delegado ao backend, que cria movimento e publica lifecycle.
- RBAC é aplicado por `<Gate>`, mas 401/403 do backend continuam sendo a autoridade final.
- A Sprint 8 não cria novas rotas fora de `/produtos`; a central usa abas para reduzir dispersão.
- Nenhum Demo Dataset novo foi criado; `demo.products.v1` deixou de alimentar `/produtos`.

Fluxo de materiais:

```text
OperationDetailDrawer
↓
GET /operations/:id/materials
↓
produto + inventory item + quantidade
↓
POST /operations/:id/materials
↓
backend cria StockMovement + AssetLifecycle
```

## Backlog — Document Template Preview

O preview de modelos agora é independente de documentos emitidos:

```text
DocumentTemplate
↓
documentsApi.previewTemplateDocument(templateId)
↓
DocumentViewer
↓
DocumentBlueprint oficial do backend
```

Decisões:

- `DocumentViewer` aceita `source={{ templateId }}` e chama `GET /documents/templates/:templateId/preview`.
- `/reports` não consulta mais uma Operation real para pré-visualizar modelos.
- Não existe preview local, `DocumentPaper`, Demo Dataset ou Operation fictícia nesse fluxo.
- Renderização definitiva de PDF para modelos continua fora do escopo; o viewer recebe `canRender=false` e `canDownload=false`.
- Erros de template inexistente, inativo, assinatura inválida, asset ausente e renderização são exibidos pelos estados padrão do Orbit/DocumentViewer.

## Backlog — Paginação Global + Modelos de Relatórios

A Platform passou a ter paginação visual e comportamental padronizada:

```text
filtros/ordenação
↓
query backend paginada ou array local já filtrado
↓
Pagination
↓
tabela/lista/card grid
```

Decisões:

- `apps/platform/components/pagination.tsx` é o único componente de paginação usado nas listagens da Platform.
- Trocar página ou tamanho de página não limpa filtros nem ordenação; filtros alterados resetam a página para `1`.
- Não foram criados endpoints nem contratos novos.
- Telas cujo backend já retorna `Paginated<T>` enviam `page` e `limit`.
- Telas ainda dependentes de dataset/demo aplicam paginação client-side sobre o resultado filtrado para evitar renderizar a lista completa.
- `/reports` não gera documento nem monta preview local: a biblioteca de modelos reutiliza `DocumentViewer`, que chama o preview oficial por `templateId`.

## Sprint 7 — Asset Lifecycle Integration

O frontend não monta mais histórico operacional local para Cliente, Equipamento ou Operação. A
arquitetura normativa é:

```text
AssetLifecycleEvent
↓
assetLifecycleApi
↓
AssetTimeline
↓
Event Drawer
├─ DocumentViewer quando documentId existir
└─ OperationDetailDrawer quando operationId existir
```

Decisões:

- `packages/api/asset-lifecycle.ts` é a única porta frontend para o Asset Lifecycle.
- `packages/ui/assets/asset-timeline.tsx` é o componente único de timeline.
- O componente consome o payload `timeline` produzido pelo `TimelineAssembler` do backend.
- O frontend não interpreta enum para ícone/cor/título/badge.
- Listagens suportam paginação, carregar mais, filtros rápidos, busca local segura, loading,
  skeleton, retry e estado vazio.
- Metadata nunca é renderizada como HTML.
- RBAC é respeitado pelo backend; o frontend apenas trata 401/403.
- O componente local antigo `@erp/ui/timeline` foi removido.

## Sprint 6 — Document Engine Integration

O frontend não possui mais pipeline local de documento oficial. A arquitetura normativa é:

```text
OperationDocument
↓
documentsApi.preview*
↓
DocumentViewer
↓
documentsApi.render*
↓
documentsApi.download*
```

Decisões:

- `packages/api/documents.ts` é a única porta para Document Engine.
- `packages/api/signatures.ts` é a única porta para assinaturas.
- `packages/ui/documents/document-viewer.tsx` é o viewer único para Platform e Operator.
- O viewer renderiza o `DocumentBlueprint` recebido do backend para preview de tela, mas nunca monta PDF.
- Renderização PDF e download sempre chamam backend.
- `/documentos` não usa mais Demo Dataset.
- Configuração documental e assinaturas vivem em `/settings` e respeitam RBAC do backend.
- Templates em `/reports` editam apenas dados persistidos em `/organization/templates`; não há editor visual nem mock de layout.

A partir da Sprint 3.0 o frontend é composto por **dois produtos independentes** que
compartilham apenas o backend, o Design System e os pacotes comuns:

- **ERP Platform** — gestão (OWNER / MANAGER), desktop-first.
- **ERP Operator** — operação de campo, mobile-first (PWA).

> Decisão: separação **in-repo** (um único projeto Next.js 15 / App Router) com
> separação física por pastas e aliases. A estrutura espelha um monorepo
> (`apps/*` + `packages/*`) e pode ser promovida a workspaces reais
> (apps/platform e apps/operator como Next apps separados) sem refatorar imports,
> pois nenhum código de produto importa o outro — apenas `packages/*`.

## Estrutura física

```
frontend/
  app/                         # Next App Router (apenas route shells finos)
    layout.tsx                 # html/body + ThemeProvider + AppProviders
    app-providers.tsx          # escolhe o app (e a sessão) pelo pathname
    login/ trocar-senha/       # auth da Platform (escopo platform)
    (platform)/                # shell autenticado da Platform (sidebar/topbar)
    operator/
      layout.tsx               # container mínimo (público)
      login/ trocar-senha/     # auth do Operator (escopo operator)
      (shell)/                 # shell autenticado do Operator (bottom nav)
  apps/
    platform/                  # código exclusivo da Platform
      components/ ...
      equipment-display.ts user-display.ts
    operator/                  # código exclusivo do Operator
      components/ ...
      shell/operator-shell.tsx
  packages/                    # compartilhado pelos dois apps
    types/   # contratos da API + documentos          -> @erp/types
    api/     # cliente HTTP único + domínios + useQuery -> @erp/api
    utils/   # cn, format, export, hooks               -> @erp/utils
    ui/      # design system, primitivos, auth, docs    -> @erp/ui/*
```

### Aliases (tsconfig `paths`)

| Alias         | Aponta para      | Conteúdo                                           |
| ------------- | ---------------- | -------------------------------------------------- |
| `@erp/types`  | `packages/types` | tipos da API e de documentos                       |
| `@erp/api`    | `packages/api`   | cliente HTTP, módulos de domínio, `useQuery`       |
| `@erp/utils`  | `packages/utils` | helpers puros e hooks                              |
| `@erp/ui/*`   | `packages/ui`    | DS, primitivos, `auth/*`, `documents/*`, `theme/*` |
| `@platform/*` | `apps/platform`  | componentes/utilitários da Platform                |
| `@operator/*` | `apps/operator`  | componentes/shell do Operator                      |
| `@/*`         | `frontend/`      | apenas route shells em `app/`                      |

Regra de dependência: `app → apps/* → packages/*`. `packages/*` nunca importa
`apps/*`; `apps/platform` e `apps/operator` nunca importam um ao outro.

## Responsabilidades

| Platform (gestão)                                                                             | Operator (campo)                                                                          |
| --------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Dashboard, Clientes, Equipamentos, Usuários, Financeiro, Relatórios, Configurações, Templates | Agenda, Atendimentos, OS, Checklist, Fotos, Assinatura, consulta de Clientes/Equipamentos |
| Visualizar, gerenciar, aprovar, editar, baixar documentos, acompanhar indicadores             | Executar serviço, capturar dados, fotografar, coletar assinatura, enviar                  |
| Desktop-first                                                                                 | Mobile-first, uma mão, poucos toques                                                      |

**Documentos:** preview estruturado, renderização e download são responsabilidade do backend.
Platform administra a Central Documental e configurações; Operator apenas consulta documentos reais
do cliente selecionado e abre o mesmo viewer quando autorizado.

## Autenticação (isolada)

Cada app tem **sua própria sessão**, nunca compartilhada:

- `packages/api/tokens.ts` é **scope-aware**: tokens vivem em
  `erp.platform.*` e `erp.operator.*` no localStorage.
- `AppProviders` monta um `AuthProvider` com `scope="platform"` ou
  `scope="operator"` conforme o pathname; o provider chama `setSessionScope`
  antes de qualquer acesso a token.
- Telas de login/troca de senha são compartilhadas (`packages/ui/auth/
{login-screen,change-password-screen}`) com `variant` por app; cada uma roda
  sob o provider escopado correspondente.
- `RequireAuth` deriva os caminhos de login/troca a partir do escopo
  (`/login` vs `/operator/login`).

O mesmo usuário pode acessar os dois ambientes; as sessões permanecem
independentes. Em produção os apps vivem em subdomínios distintos
(`erp.empresa.com.br` e `operator.empresa.com.br`), reforçando o isolamento.

## Comunicação com o backend

- Cliente HTTP **único** em `packages/api/client.ts` (`api.empresa.com.br/api/v1`):
  envelope `{success,data}`, `Authorization: Bearer`, `X-Request-Id`, refresh
  single-flight, replay em 401, emissão de invalidação de sessão.
- Os dois apps consomem exatamente os mesmos módulos de domínio
  (`usersApi`, `customersApi`, `equipmentsApi`, …). Nunca há cliente HTTP duplicado.
- **RBAC**: 100% do backend (`GET /users/me` → role + permissions). `<Gate>` e a
  sidebar apenas ocultam; 401/403 são a autoridade final. Sem regras locais.

## Design System compartilhado

`packages/ui` define cores/tipografia (via `app/globals.css` + tokens) e os
componentes base (drawers, chips, estados, tabelas auxiliares, documentos,
theme). **Layouts completos não são compartilhados**: Platform e Operator têm
shells próprios (`apps/platform/components/{sidebar,topbar}` vs
`apps/operator/shell/operator-shell`).

## Operator workflow (Sprint 3)

Fluxo de campo em `apps/operator` + `app/operator/*`, mobile-first:

- **Navegação**: bottom nav (Início/Agenda/Atendimentos/Clientes/Perfil); sem menus laterais.
- **Wizard de atendimento** (`/operator/atendimento`, route group `(full)`, sem shell): Cliente → Endereço → Equipamento → Tipo → Checklist → Observações → Fotos → Assinatura → Resumo → Enviar. Construído com `@erp/ui/wizard/*`, `@erp/ui/photo-input`, `@erp/ui/documents/signature-pad`.
- **Leitura** de clientes/equipamentos via `@erp/api` (real); agenda/serviços via Demo Dataset (`getSchedule`).
- **Documentos**: o Operator só coleta dados + assinatura; geração/visualização ficam na Platform/Backend.

### Offline-ready (arquitetura, sem sync nesta sprint)

`apps/operator/lib/offline-queue.ts` é o **outbox** local (localStorage `erp.operator.outbox`) com `status` (`pending/syncing/sent/error`), `attempts` e `flushOutbox()` placeholder. `submitAtendimento` enfileira a submissão. Quando o backend de Serviços existir, `flushOutbox` vira POST + transições de status + retry/backoff — sem refatorar a UI.

### Branding dinâmico

`@erp/ui/auth` exporta `applyBranding(primary, secondary)`. A Settings aplica ao vivo na edição e persiste via `PATCH /organization`; o `AuthProvider` reaplica no bootstrap (`GET /users/me`), propagando as cores a toda a app.

## Preparação para Backend Sprint 6 (Scheduling Domain)

A agenda do Operator consome `financialApi.getSchedule` (hoje Demo Dataset `demo.schedule.v1`). Ao surgir o domínio real, basta apontar essa função para o novo endpoint em `packages/api` — Home, Agenda e a lista de atendimentos passam a ser funcionais sem mudança de UI. O Wizard já produz uma submissão estruturada (`AtendimentoSubmission`) pronta para o POST de criação de OS.

## PWA (Sprint 4)

O app instalável é o **Operator**. `app/manifest.ts` define identidade azul/branco, `display: standalone` e `start_url`/`scope` `/operator`. `@erp/ui/pwa` provê `useInstallPrompt` (beforeinstallprompt + detecção iOS/standalone) e `InstallButton` (Perfil do operador), com fallback iOS "Adicionar à Tela de Início". Service worker / cache offline ficam para o futuro (offline-ready já estruturado no outbox).

## Demo dataset → telas (Sprint 4)

O endpoint `/internal/demo/dataset` retorna todo `demo.*` dinamicamente. Além de dashboard/schedule/finance, foram adicionados `demo.orders.v1` e `demo.products.v1` — consumidos por `@erp/api/operations` (`getOrders`/`getProducts`) nas telas de Ordens e Produtos. Quando os domínios reais existirem, troca-se a implementação em `packages/api/operations.ts` sem mudar as telas.

## QR (Sprint 4)

Platform exibe o QR (matriz visual determinística + código real) com copiar/baixar PNG. Operator resolve por simular/colar/selecionar (sem scanner nativo ainda). Um encoder de QR real e a resolução pública por scan são escopo futuro do backend.

## RC1 (Sprint 5)

- **Branding**: `@erp/ui/brand` (BrandLogo) + `public/brand/*` + `app/icon.png`/`apple-icon.png`. Tema azul/branco definitivo; cores dinâmicas do OWNER preservadas.
- **Central documental** antiga (`/reports`) e **Serviços/histórico** (`/servicos`) consumiam `demo.documents.v1`/`demo.services.v1` via `@erp/api/operations`; a Sprint 6 substituiu documentos oficiais pelo Document Engine.
- **Timeline** (`@erp/ui/timeline`) reutilizada em Serviço/Cliente/Equipamento.
- **Docker**: `frontend/Dockerfile` (Next `output: standalone`) + serviço `frontend` no compose (serve Platform e Operator; subdomínios via proxy em produção). Vars: `FRONTEND_PORT`, `NEXT_PUBLIC_API_BASE_URL`.
- Não existe bridge, rota ou flag de dataset demonstrativo no runtime.

## Subdomínios / deploy futuro

Promoção a monorepo real: mover `app/(platform)+login+trocar-senha` para
`apps/platform` (Next app) e `app/operator/*` para `apps/operator` (Next app),
mantendo `packages/*` como workspaces. Como nenhum produto importa o outro e
todo compartilhamento passa por `@erp/*`, a divisão é mecânica.

## Assignment Domain + Operator Workflow

Assignment é consumido como domínio real no frontend:

```text
Operation
↓
Assignment
↓
Operator workflow
```

Camadas:

- `packages/api/assignments.ts`: único client HTTP de Assignment;
- `packages/types`: contratos compartilhados;
- `packages/ui/assignments`: labels e helpers visuais;
- Platform: criação/agenda/drawer consomem Assignment;
- Operator: Home, Agenda, Minhas Ordens e detalhe consomem `/assignments/my`.

Regras arquiteturais:

- frontend não interpreta autorização; backend decide RBAC e transições;
- frontend não cria agenda, OS ou serviço paralelo;
- timeline de execução vem do backend;
- fluxo visual do Operator apenas chama transições oficiais (`accept`, `start`, `complete`,
  `reject`).

## Budget Domain

Budget é integrado como domínio comercial real da Platform:

```text
Product/Pricing
↓
Budget
↓
Operation (opcional)
↓
Document Engine / Asset Lifecycle
```

Camadas:

- `packages/api/budgets.ts`: único client HTTP do domínio;
- `packages/types`: contratos `Budget*`;
- `/budgets`: Central Comercial;
- `OperationDetailDrawer`: visão de orçamentos da Operation;
- Dashboard: widgets reais via `/budgets/stats`.

Regras arquiteturais:

- frontend nunca calcula preço, custo, margem, subtotal ou total como fonte de verdade;
- criação envia apenas cliente/operação/equipamento, data, observações e itens;
- snapshots comerciais vêm exclusivamente do backend;
- histórico vem de `/budgets/history/:id`;
- emissão documental usa `POST /budgets/:id/render`;
- download documental usa `GET /budgets/:id/download`;
- visualização usa `DocumentViewer` com `documentId` oficial;
- não existe `DocumentPaper`, renderer local ou preview de template como substituto do documento emitido;
- RBAC visual usa `<Gate>`, mas backend é a autoridade final.

## Financial & Procurement Integration

Sprint Frontend 11 integrou dois domínios reais sem alterar contratos do backend:

```text
Platform
↓
packages/api/financial.ts      packages/api/procurement.ts
↓                               ↓
Financial Core                  Procurement
↓                               ↓
saldo/histórico                 recebimento → Inventory
```

Regras arquiteturais:

- componentes nunca chamam `fetch` diretamente;
- todo acesso financeiro passa por `financialApi`;
- todo fluxo de compra passa por `procurementApi`;
- frontend não calcula saldo financeiro como fonte de verdade;
- frontend não altera estoque, não gera `StockMovement` e não calcula saldo físico;
- recebimento de compra envia apenas os itens/quantidades recebidos; Inventory é atualizado pelo backend;
- snapshots de compra (`snapshotCost`, `snapshotDescription`) são enviados/exibidos como contrato do Procurement, mas a integridade fica no backend;
- histórico financeiro e histórico de compra são consumidos dos endpoints oficiais;
- dashboard principal consome `GET /financial/stats` e `GET /purchase-orders/stats`;
- RBAC visual esconde ações para perfis sem acesso, mas backend continua sendo a autoridade.

Namespaces adicionados:

- `financialApi`: accounts, categories, entries, pay, cancel, stats, history;
- `procurementApi`: purchase orders, items, receipts, send, cancel, stats, history.

Componentização:

- drawers financeiros ficam em `apps/platform/components/financial-drawers.tsx`;
- drawer de compras fica em `apps/platform/components/purchase-order-drawer.tsx`;
- badges de status ficam em `apps/platform/components/financial-procurement-badges.tsx`;
- paginação continua centralizada em `apps/platform/components/pagination.tsx`.

## Executive Dashboard & Operational Intelligence

O dashboard da Platform é uma composição de domínios reais, não um domínio analítico novo:

```text
Assignments / Operations
Financial
Maintenance / PMOC
Inventory / Procurement
Asset Lifecycle
        ↓
app/(platform)/page.tsx
        ↓
Executive Dashboard
```

Decisões:

- nenhum endpoint novo foi criado nesta sprint;
- foram adicionados apenas clients frontend para endpoints já existentes (`maintenanceApi`, `pmocApi`);
- a home removeu `dashboardApi` e dependências do Demo Dataset;
- agregações de negócio continuam no backend (`/financial/stats`, `/inventory/stats`, `/purchase-orders/stats`, `/maintenance-plans/stats`, `/pmoc/stats`, `/operations/stats`);
- listas usadas para contexto visual são bounded (`limit` pequeno);
- não há leitura de `AuditLog`;
- atividade recente vem de `AssetLifecycle`, já montado pelo `TimelineAssembler`;
- cada seção usa `useQuery` próprio para preservar falha parcial.

RBAC/AppSec:

- Financial só é requisitado quando a sessão tem `OWNER`/`MANAGER` e `canFinancial`;
- Procurement só é requisitado para `OWNER`/`MANAGER`;
- dados financeiros não são pré-carregados para perfis sem permissão;
- erros são exibidos por `ErrorState`, sem renderizar payload bruto;
- metadata de timeline é exibida apenas por campos seguros (`timeline.title`, `subtitle`, `description`, `date`).

Performance:

- o dashboard evita baixar páginas completas para contagens quando existem endpoints de stats;
- usa stats por domínio como fonte principal;
- usa listas pequenas apenas para contexto acionável;
- caso o volume real exija, a próxima etapa recomendada é um endpoint read-only agregado de dashboard, sem criar plataforma de analytics.

## Sprint 18 — Product UX Consolidation

Polish arquitetural aplicado sem novo domínio:

- rotas legadas passaram a redirecionar para fluxos oficiais;
- sidebar remove destinos duplicados que apontavam para telas demo;
- dashboard e páginas destino compartilham deep-links por querystring;
- parsing de querystring é whitelist-based:
  - status de Operation;
  - status/type/origin de Financial;
  - status de Purchase Orders;
  - tabs de Products.

Estratégia de forms/feedback:

- nenhum novo sistema global de notificações foi criado;
- os fluxos continuam usando feedback local existente (`ErrorState`, mensagens inline, loading state em botões/drawers);
- máscara/formatting existente de CPF/CNPJ foi preservada;
- entradas monetárias/quantidade continuam formatando exibição sem recalcular regras oficiais.

Segurança frontend:

- links contextuais não passam dados sensíveis;
- query params inválidos são ignorados;
- rotas demo/stale não carregam mais dados demo;
- imagens blob/base64 usam `next/image unoptimized` quando seguro;
- `<img>` restante é intencional para BrandLogo local e renderizadores documentais/base64.

Performance:

- eliminadas telas legadas que carregavam Demo Dataset;
- removida duplicação de navegação para Serviços/Ordens;
- lint sem warnings reduz ruído de certificação;
- bundle da home aparece maior no relatório do Next e deve ser investigado com bundle analyzer na Sprint 21 antes de qualquer refator especulativo.

## Sprint 20.5 — AppSec Closure Architecture

Asset Lifecycle é tratado como API pública sanitizada. Componentes devem renderizar a timeline usando `event.timeline` e `event.timeline.references`, sem interpretar metadata bruto nem usar chaves de storage.

Fluxos com `URL.createObjectURL` devem manter ciclo de vida explícito: revogar URL ao remover o item, substituir preview ou desmontar o componente. O fluxo de Visita Técnica já segue essa regra.

## Sprint 22 — production readiness architecture

Frontend production configuration:

- `NEXT_PUBLIC_API_BASE_URL` may be `/api/v1` when the deployment has a same-origin reverse proxy.
- `NEXT_PUBLIC_ENABLE_DEMO` defaults to `false` and must be enabled explicitly only for demo/dev.
- The shared API client resolves relative API bases against `window.location.origin` in the browser.

Release topology:

- `docker-compose.rc.yml` provides a representative local topology with `frontend`, `api`,
  `postgres` and `proxy`.
- The proxy routes `/api/v1/*` to the API and all other paths to the Next frontend.
- Real TLS/certificate/HSTS verification remains an environment responsibility and was not proven in
  this repository workspace.

## Sprint 22.5 — V1 deployment boundaries

Orbit V1 frontend is certified for isolated single-company installations only:

- one customer-facing frontend per deployment;
- one API/database/storage scope per deployment;
- no shared application-level tenant switching;
- no frontend behavior should rely on a tenant selector.

Supply-chain closure:

- frontend uses `overrides.postcss=8.5.16` to remediate the transitive PostCSS advisory bundled
  through Next 15.5.x.

## Product Backlog Closure 01 — architecture notes

Arquitetura preservada:

- Product continua sendo catálogo técnico, sem preço e sem saldo físico.
- Pricing continua sendo a única fonte comercial para custo/preço/margem/vigência.
- Supplier continua pertencendo ao Inventory/Procurement como base para compras; a relação
  Product↔Supplier foi posteriormente oficializada no Product Backlog Closure 01.1 por junction
  backend, sem mover regra de compras para Product.
- CustomerAddress continua sendo recurso separado de Customer; criação com endereço usa duas mutações reais e estado de retry seguro.
- Equipment continua validando endereço pelo cliente selecionado; o frontend não permite seleção fora da lista carregada daquele cliente.
- Reports/Modelos continua renderizando via Document Engine e `DocumentViewer`; não há preview local nem `DocumentPaper`.

## Product Backlog Closure 01.1 — architecture notes

- Product form consome `inventoryApi.listSuppliers` em query própria para não depender da aba
  Fornecedores nem da paginação/filtro atual da página.
- A criação inline de fornecedor reutiliza o `SupplierDrawer` oficial; o fornecedor retornado é
  temporariamente mesclado às opções até o refetch concluir.
- O frontend persiste fornecedor principal enviando `primarySupplierId` e consome
  `Product.suppliers[]`; não há cache local como fonte de verdade.
- Pricing tab abre o `PricingDrawer` oficial independentemente da página atual do catálogo de
  produtos; o drawer carrega produtos ativos e chama `pricingApi`.

CEP:

- `cepApi.lookupCep` é um boundary externo isolado para preenchimento assistido.
- O resultado não é confiado cegamente: todos os campos permanecem editáveis antes da persistência.
- Falhas de CEP não bloqueiam cadastro manual.

Mutation/state safety:

- se `createCustomer` passa e `createAddress` falha, o drawer preserva o `createdCustomerId` para retry apenas do endereço;
- o fluxo evita duplicação de cliente em retry;
- erros do backend continuam exibidos como mensagens inline, sem renderizar payload bruto.

## Product Backlog Closure 02 — document workflow architecture

Fluxo oficial no frontend:

```text
/reports
→ escolher tipo documental
→ escolher Operation real
→ DocumentViewer
→ preview oficial
→ render oficial
→ download autorizado
→ /documentos lista o OperationDocument emitido
```

Regras preservadas:

- nenhum PDF é gerado no frontend;
- nenhum preview autoritativo é montado por componente local;
- `DocumentViewer` é a superfície única de visualização/render/download;
- `/documentos` não compete com `/reports`: ele representa histórico/repositório.

Performance:

- preview não renderiza PDF automaticamente ao abrir drawer;
- render é ação explícita do usuário;
- download ocorre apenas depois de `documentId` existente/renderizado.

## Document Semantics Closure — preview mode architecture

Model Preview e Real Data Preview são caminhos distintos:

```text
Template → TemplatePreviewContext → Blueprint → DocumentViewer
```

Sem render/download oficial.

```text
Operation → DocumentContext → Builder especializado → Blueprint → Render → PDF → Download
```

Com render/download explícitos.

Taxonomia V1:

- `TECHNICAL_REPORT` é factual/operacional.
- `TECHNICAL_OPINION` é analítico/conclusivo com dados existentes.
- `REPORT` é compatibilidade histórica.

## Product Backlog Closure 03 — PDF exports and signature UX architecture

List exports now use backend-generated PDF blobs:

```text
Platform list page
→ ExportButton.onPdf
→ packages/api api.blob()
→ backend /operations|documents|equipments/export
→ browser Blob download
```

Architecture rules:

- frontend never generates list PDFs;
- CSV remains a local convenience export for visible rows only;
- PDF export uses active filters and the backend record limit;
- `api.blob()` preserves auth, request id and refresh-token replay behavior;
- filenames are taken from `Content-Disposition` when available and sanitized before download.

Signature management:

- public signature objects use `hasImage`; frontend never receives or stores `imageStorageKey`;
- upload and freehand drawing converge to the same backend upload endpoint;
- freehand capture is client-side input only, exported as transparent PNG and persisted by the official signature storage pipeline;
- deleted signatures are removed by backend filtering, not by frontend-only hiding;
- the Settings signature area uses a Drawer to keep creation, editing, upload, drawing and preview in a single reusable workflow.

## Product Backlog Closure 04 — Avatar and Notification architecture

Avatar flow:

```text
File selection → Canvas crop 512×512 PNG → POST /users/avatar → AuthProvider.refresh()
→ session.user.avatarAssetId → UserAvatar → GET /users/avatar/:id
```

Identity state remains centralized in `AuthProvider`; no second user store was introduced.

Notification flow:

```text
Domain transition → NotificationsService inside transaction → Notification rows
→ Topbar/Operator bell → unread/list/read APIs
```

No WebSocket/realtime infra was added. V1 refresh uses shell load, focus/visibility and 60s polling
while visible.

# Closure 06 — document source consistency

O frontend distingue três fontes: template preview, Operation preview e documento persistido. Para
Work Order, a fonte real é sempre `operationId + WORK_ORDER`. A API bloqueia download obsoleto; o
cliente apresenta o erro e exige render explícito depois de mutations. Datas operacionais não são
normalizadas para um campo genérico: `createdAt` e `scheduledFor` permanecem conceitos distintos.

# Closure 06.1 — runtime UI and nested overlays

Drawers são portais para `document.body`; isso impede que transforms de um drawer pai criem um novo
containing block para overlays `fixed`. DocumentViewer mantém blueprint oficial e passa a ocupar a
largura solicitada mesmo quando aberto a partir de OperationDetailDrawer ou Timeline.

O script `test/runtime/verify-operations-ui.mjs` valida opt-in a rota ativa, contrato visível, drawer
e assinatura no preview sem introduzir uma suíte/browser como dependência de produção.

## DC02B — Corporate Header e persistência

`DocumentViewer` continua sendo projeção do Blueprint. O Builder monta o Corporate Header com dados
de Organization já carregados pelo DocumentContext; o frontend não consulta assets nem recompõe a
identidade corporativa.

O workflow persiste primeiro os dados documentais na Operation e só então solicita Preview. Assim,
regenerações não dependem de estado React ou de campos técnicos que mudem depois da emissão.

# Technical Report form architecture

Catalog entries are fetched through `maintenanceChecklistTemplatesApi`. The UI uses their IDs only while selecting; it sends immutable description/type/execution/observation snapshots through the existing Operation API. Equipment choices similarly map to `inspectedEquipments[]`. This keeps DocumentContext and the official Document Engine unchanged and prevents the renderer from querying mutable catalogs.

# Work Order creation architecture

A OS independente não é uma entidade local: o frontend cria uma Operation DRAFT e usa o documento
WORK_ORDER que o backend cria transacionalmente. Múltiplos equipamentos são snapshots da Operation.
Galerias são componentes do Blueprint e possuem implementações correspondentes no Viewer e no
Renderer PDF, preservando paridade e evitando geração local.

## Technical Catalog architecture

```text
TechnicalCatalog API
  → technicalCatalogsApi
  → TechnicalCatalogSelector / TechnicalCatalogList
  → ordered text snapshots
  → Operation technicalOpinion* fields
  → DocumentContext
  → DocumentBuilder / Blueprint
  → DocumentViewer and PdfEngine
```

O catálogo é uma infraestrutura de entrada, não uma dependência de renderização. A UI nunca envia
um objeto de catálogo ao Document Engine. O texto final fica imutável em relação a futuras edições
do catálogo. Platform e Operator compartilham o seletor, mas conservam composições adequadas ao
contexto: edição avançada na Platform e interação compacta em campo.

Os labels das tabs vêm de `/technical-catalogs/types`; os componentes não mantêm um segundo enum de
apresentação. Autorização visual usa o AuthProvider, enquanto o backend continua autoridade RBAC.

Closure 08.1 acrescenta classificação sem acoplar catálogo e documento:

```text
equipment types → areas + workflow → filtered API (+ GENERAL)
  → shared selector → textual snapshots → Operation → official Document Engine
```

Taxonomia vem do backend e a filtragem principal é server-side. Platform e Operator escolhem apenas
o contexto; PMOC pode reutilizar a API com `workflow=PMOC`.

## DC-04 — fluxo PMOC

`PmocPlan → MaintenanceExecution → Operation → DocumentContext → DocumentBuilder → Blueprint →
DocumentViewer/PdfEngine`. Platform e Operator editam somente a Operation atribuída. Procedimentos
e dados técnicos são snapshots; o frontend não calcula conformidade nem monta documentos.

## Narrativa estruturada do Laudo Técnico

`TechnicalCatalogSelector → *Items[]` e `Area → texto principal` são persistidos na mesma
Operation, porém em campos independentes. O Document Engine recebe snapshots completos pelo
DocumentContext e compõe parágrafo + lista no único Blueprint usado por Preview e PDF.

## PMOC como origem do fluxo operacional

`PmocPlan numerado → MaintenancePlan → MaintenanceExecution → Operation oficial → WORK_ORDER →
Document Engine`. A criação/gestão do plano usa `pmocApi`; a OS usa `operationApi` e permanece uma
Operation normal. Não existe fluxo documental, agenda ou entidade de OS paralela.

## PMOC UX-01

```text
PmocPlan(equipmentIds, serviceTypes, signatureOverrideId)
  → ExecutionRequest → Operation(inspectedEquipments, serviceTypes)
  → Assignment → MaintenanceExecution
  → DocumentContext(template policy + PMOC override)
  → Blueprint único → Preview/PDF
```

O frontend apresenta; o backend valida e propaga. O `DocumentContext` é a única camada que resolve
assinaturas e o Operator consulta a configuração oficial para decidir a UX de coleta.

## Field Report Handoff 01

```text
Operator / Operation atribuída
  → conteúdo + equipamentos + evidências + assinatura do cliente
  → OperationDocument(DRAFT, origin=OPERATOR) + DocumentRevision
  → Platform Inbox → revisão(PENDING) → assinatura técnica → READY
  → DocumentContext(snapshot cliente + snapshot técnico)
  → Blueprint único → Preview → Render → PDF → /documentos
```

O estado editorial é independente do artefato. Edições posteriores produzem STALE e nova revisão,
sem apagar PDF nem histórico. Componentes de UI não consultam Storage, não calculam políticas de
assinatura e não geram documentos localmente.

## PMOC FIX-01

```text
PmocExecutionRequest (ID estável)
  → Operation + documento PMOC atual
  → DocumentViewer
  → Preview / Render / Download oficiais
  → refetch da execução por ID
  → /documentos
```

O estado STALE é determinado pelos fingerprints produzidos pelo backend. O frontend não acessa
Storage, não gera PDF e não reconstrói o Blueprint.
# PMOC FIX-02A — decisão arquitetural

O estado técnico do plano (`signatureOverrideId`) e o snapshot documental (`OperationDocument` handoff) são atualizados pelas APIs oficiais. O primeiro orienta futuras emissões do PMOC; o segundo atualiza o documento corrente. O preview é sempre solicitado ao Document Engine, evitando regra de assinatura ou renderização no frontend.

## PMOC FIX-02B — decisão arquitetural

```text
PmocPlan → ExecutionRequest → OperationPhoto/StorageProvider
  → DocumentContext → imageGallery no Blueprint
  → mesmo Preview → Renderer/PDF
```

O Wizard edita a coleção oficial da Operation e invalida o Preview após cada resposta. Autoria e datas vêm do backend; conteúdo passa por endpoint autenticado. O frontend não replica fotos em estrutura PMOC, não lê Storage e não monta galeria documental local.

## Workflow de origem do atendimento

```text
Operator inicia
  → Operation(requestedDocumentType) → Assignment próprio
  → accept → start → complete → handoff submit
  → DRAFT → aprovação da gestão

Gestão delega
  → Operation(requestedDocumentType) → Assignment delegado
  → Operator executa → handoff submit
  → REVIEW → aprovação/finalização da gestão

Operator inicia PMOC
  → PmocPlan → ExecutionRequest elegível → Operation → Assignment
```

O frontend apenas apresenta `workflowStatus`; a origem e a transição são decididas pelo backend.

## PMOC — composição da experiência de gestão

```text
/pmoc
  ├─ Visão geral → PmocStats + PmocPlan list + PmocPlanWizard(create)
  └─ Agenda → PmocStats.calendar/upcoming/recent + filtros de apresentação

/pmoc/:id
  → PmocPlan + ExecutionRequests + History
  → PmocPlanWizard(edit/review)
  → update/delete oficiais
```

O calendário e as listas usam as mesmas Execution Requests retornadas pelo backend. Os filtros não recalculam recorrência nem status. Finalização chama a desativação oficial e não remove histórico.
## DC-06 — fluxo comercial documental

```text
BudgetWizardDrawer
  → Budget API (itens comerciais independentes)
  → OperationDocument(BUDGET)
  → Handoff oficial de assinaturas
  → DocumentContext → DocumentBuilder → Blueprint
  → DocumentViewer → Render → PdfEngine → Download autenticado
```

A seleção opcional da OS apenas preenche campos editáveis. Product, Pricing e Inventory não participam da composição DC-06. Preview e PDF consomem o mesmo Blueprint.
# Customer Workspace architecture

O cliente é o ponto de navegação para ativos, atendimentos e vendas, mas cada domínio mantém ownership no backend. `equipmentsApi`, `operationApi` e `salesApi` continuam independentes e recebem `customerId` como filtro. `SaleFormDrawer` envia somente intenção (`productId`, quantidade, garantia); `PricingService` e `SalesService` são autoridades sobre snapshots e totais. Recibo permanece no fluxo `Operation → Document Engine` e referencia a venda por `sourceSaleId`.
# Operator signature onboarding

A assinatura de primeiro acesso utiliza a mesma entidade `Signature`, API, validação, Storage e seletores da Platform. O frontend converte o PNG confirmado pelo `SignaturePad` em `File` apenas para o multipart e não mantém base64 após a requisição. A associação `Signature.userId` preserva ownership sem criar um domínio paralelo.
# Catálogo único e finalidades comerciais

Compra e venda não possuem catálogos paralelos. `Product` é a fonte única e expõe `isPurchasable`/`isSellable`; as abas apenas aplicam filtros server-side. `SaleFormDrawer` solicita `sellable=true`, enquanto Procurement e materiais solicitam `purchasable=true`. O backend revalida a classificação no comando transacional, portanto alterações concorrentes não podem ser contornadas por uma lista previamente carregada.
# Orquestração visual Product + Pricing

`ProductFormDrawer` coordena duas APIs sem misturar ownership: primeiro persiste o catálogo por `inventoryApi`, depois cria a vigência inicial por `pricingApi` quando houver valores. A segunda etapa não adiciona preço ao payload de Product. Em falha parcial, o produto criado é preservado e a UI orienta correção pela área de preços, evitando repetição e conflito de SKU.
# Disponibilidade comercial no SaleFormDrawer

O seletor de venda deixou de derivar disponibilidade apenas de `Product.isSellable`. Ele consulta Pricing vigente em `soldAt`, reutiliza a relação Product retornada e apresenta o valor ao usuário. SalesService repete todas as validações e cria snapshots, evitando confiança no frontend. No estoque, o frontend nunca envia saldo final: apenas movimentos ou parâmetros, preservando Inventory como autoridade física.

# Paridade Platform/Operator para Ordem de Serviço

Os dois ambientes persistem o mesmo contrato de conteúdo da Operation (`reportedIssue`, `serviceDescription`, `observations`, checklist, equipamentos e evidências). O Operator adiciona a etapa obrigatória de identidade e assinatura do cliente/responsável. A captura gera um único timestamp compartilhado entre Operation e snapshot do handoff; Preview e PDF recebem esses dados pelo mesmo DocumentContext.

A interface bloqueia avanço sem assinatura, mas o backend permanece como autoridade e repete a validação na criação e na conclusão do Assignment.

O resumo apresentado na etapa de assinatura é somente uma projeção dos estados já coletados no Wizard. A conclusão de OS/RVT continua executando Assignment complete → handoff finalize → render oficial; não existe estado de revisão intermediário nesses documentos de campo.

# Assinatura técnica própria no mobile

O mobile não possui catálogo paralelo. `Signature.userId` identifica a assinatura própria; o Wizard persiste somente seu ID em `OperationDocument.technicalSignatureId`. Na finalização, o backend copia a imagem pelo `DocumentAssetResolver` para `technicalSignatureSnapshot`. Assim, alterações futuras no perfil não modificam PDFs históricos e o DocumentContext continua sendo a única origem do Builder.
## Semântica do checklist da OS por origem

- OS iniciada pelo Operator: o catálogo é uma lista opcional de atividades realizadas; somente a seleção é persistida e entra com `done: true`.
- OS criada/atribuída pela Platform: a seleção representa o plano enviado ao atendimento e permanece pendente até a execução do técnico.
- Ambos os fluxos consomem o mesmo Catálogo Técnico e a mesma propriedade `Operation.checklist`; a diferença é definida na origem do workflow, sem domínio ou endpoint paralelo.
## Classificação dos checklists documentais

```text
TechnicalCatalog
├── CHECKLIST + WORK_ORDER/PMOC  → OS e PMOC
└── CHECKLIST + TECHNICAL_REPORT
    ├── WEEKLY                   → RVT semanal
    └── SEMIANNUAL               → RVT semestral
```

A separação é feita por workflow no catálogo oficial. Não existem arrays locais, tabela paralela
ou adaptação no Document Engine. Os wizards geram o mesmo snapshot estruturado da Operation, que
continua alimentando Preview e PDF.

# PMOC: plano agregado, execução unitária

```text
PmocPlan (N equipamentos)
  → PmocExecutionRequest (1 equipamento)
  → MaintenanceExecution
  → Operation (1 equipamento + evidências próprias)
  → DocumentContext
  → Preview / PDF / Repositório
```

O wizard dedicado evita condicionais no `OperationCreationDrawer` e somente orquestra APIs
oficiais. O backend continua sendo a autoridade sobre cobertura, numeração e relacionamentos.
# PMOC — compartilhamento Platform/Operator

O executor por equipamento reside na camada compartilhada da Platform e é consumido pelo Operator,
evitando dois wizards e duas regras de persistência. O seletor mobile apenas resolve
`PmocPlan + equipment + PmocExecutionRequest + prefill`; toda mutação permanece nas APIs oficiais.
O PDF é obtido como `Blob` autenticado e nunca é montado no navegador.

## Navegação de tabelas e ações

`DataTable.rowHref` cobre somente colunas navegáveis. Controles de ação declaram `link: false`,
mantendo a semântica de um único destino por interação e evitando `<button>` dentro de `<a>`.

## Data documental do Recibo

A seleção de uma OS é apenas uma fonte de preenchimento. A data de emissão pertence ao novo Recibo
e é inicializada pelo cliente web com a data civil local no momento da seleção; o backend persiste
o valor explícito em `receiptIssuedAt`.

## Cancelamento operacional

```text
Operator Wizard
  → OperationCancellation REQUESTED
  → WORK_ORDER DocumentContext/Blueprint/PDF
  → Platform Review
      ├─ RESCHEDULED → mesma Operation + mesmo Assignment
      └─ APPROVED    → Operation CANCELED
```

O frontend não infere transições nem monta relatório. Estados, ownership e consistência são
autoritativos no backend; Preview e PDF continuam derivados do mesmo Blueprint.

Após o render oficial, o resultado documental é entregue a um estado terminal dedicado. Esse estado
usa exclusivamente o download autenticado do Document Engine e a Web Share API; abrir o
`DocumentViewer` permanece uma ação explícita do usuário, nunca um efeito automático da conclusão.
# Coleta contextual de ativos

O Operator não recebe acesso ao CRUD administrativo de Equipment. O frontend utiliza uma operação
contextual, ligada ao Assignment, que envia seleção e novos registros em lote. O backend deriva
cliente/endereço, cria os ativos e os snapshots da OS atomicamente; o frontend apenas substitui seu
estado pelos `inspectedEquipments` retornados.

# Estado terminal do draft documental

`draftMaterialized` separa edição local de registro oficial. Quando verdadeiro, bloqueia novos ciclos
do autosave debounced e garante que `clear()` não seja revertido por um render posterior do formulário.

# Agregado de cadastro avulso

O cadastro avulso reutiliza a coleção visual da execução atribuída, mas persiste pelo agregado
transacional `Customer walk-in`: cliente, endereço, contato e N equipamentos são criados juntos. A
API devolve os IDs de domínio e somente então o Wizard cria a Operation com todos os snapshots; não
existe criação otimista de Equipment nem estado persistente paralelo no frontend.

## RVT configurável (2026-08-03)

`RvtPlan -> RvtExecution -> MaintenanceExecution -> Operation -> Assignment -> DocumentContext -> Document Engine`.

- `packages/api/rvt.ts` é o client único; páginas não usam `fetch` direto.
- Planejamento especializa e não substitui agenda, execução ou documentos.
- Platform e Operator convergem na mesma Operation; Preview, Renderer, PDF, Storage e repositório permanecem inalterados.
- Objetos de leitura nunca são reutilizados diretamente como comandos: o adapter do wizard projeta o
  checklist para o contrato gravável antes do PATCH.
- O rascunho visual de Equipment pertence ao componente; o wizard conserva apenas a coleção de
  itens confirmados, impedindo formulários incompletos no payload.
- A garantia de Assignment pertence ao backend. O frontend apenas decide entre gerenciar a
  atribuição existente ou assumir a execução e iniciar suas transições oficiais.
- O detalhe de uma ocorrência reutiliza `OperationDetailDrawer` no contexto de `/rvt/[id]`; não há
  transição para a Central de Operações nem implementação paralela de atribuição.
- O workflow de coleta aceita superfícies distintas: a Platform o hospeda em `RvtExecutionDrawer`,
  enquanto o PWA mantém suas rotas próprias. Ambos persistem na mesma Operation/Assignment e não
  duplicam regras de conclusão ou emissão documental.
- A equipe mantém uma Assignment primária e N secundárias. Somente a primária conduz estados;
  auxiliares não entram no DocumentContext e não invalidam o PDF.
- A UI não deriva URL de storage: localiza o `TECHNICAL_REPORT` `READY` projetado na execução e
  delega o download ao client oficial do Document Engine.

- O catálogo RVT é mesclado por identidade no estado do wizard: dados persistidos prevalecem e o
  catálogo complementar preenche apenas itens ausentes. Isso evita perda de coleta em refetch.
- A tela de conclusão documental é compartilhada entre atendimento avulso e execução atribuída;
  não existe fluxo paralelo de download/compartilhamento.
- A composição da equipe é submetida por um único contrato de Assignment. O frontend não tenta
  reconciliar auxiliares em uma segunda atualização de Operation.
- A identidade documental e a identidade da execução permanecem conceitos separados no Blueprint;
  componentes frontend não recalculam nem sobrescrevem nenhuma delas.
