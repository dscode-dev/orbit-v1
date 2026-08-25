# Backend State

## Recibo com fonte descritiva única — 2026-08-24

- O Document Builder usa `receiptDescription` como fonte oficial da descrição em novos Recibos.
- `receiptService` é somente fallback de leitura para documentos históricos; não existe migration
  destrutiva nem mudança no download, Preview, Renderer ou PDF Engine.

## Portal do Cliente e Central de Chamados — 2026-08-21

- Identidade externa isolada em `CustomerPortalAccount`; nunca utiliza `User`, `Role` ou refresh
  tokens internos. Tokens próprios são aceitos somente pelo `CustomerPortalAuthGuard`.
- Migration aditiva `20260817120000_customer_portal_tickets`: contas, refresh tokens e
  `CustomerServiceTicket`, sem alterar dados existentes. Endereços/equipamentos são validados
  contra o cliente autenticado.
- O portal entrega projeções sanitizadas de cadastro, equipamentos, Operations, PMOC/RVT e
  documentos, sem custos, `storageKey`, paths, base64, assinaturas binárias ou metadata interna.
- Chamados são convertidos transacionalmente pela `OperationsService`; Operation, Assignment e
  vínculo permanecem no fluxo oficial, com no máximo uma Operation por chamado.
- Login interno recebeu `channel=PLATFORM|OPERATOR`: Platform aceita OWNER/MANAGER; Operator aceita
  OWNER/OPERATOR. Contas de cliente usam senha temporária forte e troca obrigatória.

## Hotfix RVT — preparo idempotente e Assignment única (2026-08-03)

- `OperationsService.create` permanece como único responsável por criar a Assignment primária de
  uma nova execução RVT; o hook do planejamento apenas vincula `RvtExecution`,
  `MaintenanceExecution`, assinatura técnica e auditoria.
- Removida a segunda criação que violava a constraint única `(operation_id, assigned_to)` e fazia
  rollback integral do `POST /rvt-executions/:id/prepare`.
- Execuções preparadas anteriormente continuam usando o reparo idempotente existente quando não
  possuem Assignment primária. Nenhuma migration ou mudança de contrato foi necessária.

## Hotfix RVT — validação da equipe auxiliar (2026-08-03)

- `UpdateOperationDto` aceita oficialmente `auxiliaryOperatorIds` no `PATCH /operations/:id`,
  mantendo whitelist, UUID v4, unicidade e limite de dez usuários.
- Um teste executa o DTO pela mesma configuração do `ValidationPipe` global para impedir que o
  contrato TypeScript exista sem os decorators no artefato JavaScript compilado.
- Falhas de validação agora registram somente as violações normalizadas em `errorDetails`; corpo,
  assinaturas e imagens da requisição continuam fora dos logs.
- Nenhuma migration ou alteração de contrato adicional foi necessária.

## Cancelamento operacional documentado — 2026-08-02

- `OperationCancellation` registra a solicitação do técnico, motivo, evidências, assinatura técnica,
  assinatura opcional do cliente e decisão da gestão.
- Estados: `REQUESTED`, `RESCHEDULED` e `APPROVED`. A Operation permanece em `REVIEW` durante a
  análise, volta a `PENDING` no reagendamento e somente recebe `CANCELED` após aprovação.
- O Assignment é marcado `REJECTED` na solicitação, reutilizado no reagendamento e finalizado como
  `CANCELED` na aprovação. Todo movimento gera `AssignmentHistory` e `AuditLog` append-only.
- O relatório de cancelamento reutiliza o documento `WORK_ORDER` e o fluxo
  `DocumentContext → Builder → Renderer → PdfEngine → Storage`.
- Evidências usam `OperationPhoto.cancellationId`; fotos de uma tentativa cancelada não vazam para
  uma execução posteriormente reagendada.
- Migration aditiva: `20260802120000_operation_cancellation_workflow`.

## Certificação das migrations recentes para produção (2026-07-28)

- As migrations `20260728180000`, `20260728181000` e `20260728190000` foram ensaiadas sobre clone
  integral do banco com dados, reconstruído no estado imediatamente anterior a elas.
- O backfill de Budget foi endurecido: somente snapshots já integralmente zerados e com
  correspondência exata no catálogo recebem `source=CATALOG`; valores históricos nunca são
  alterados.
- A reconciliação PMOC é transacional e atualiza apenas projeções derivadas de Operations
  concluídas.
- Contagens e hashes de Customers, endereços preexistentes, Operations e documentos permaneceram
  idênticos. Todas as constraints continuaram validadas.
- Tempo observado para as três migrations no clone local: 2,939 segundos, incluindo overhead do
  Prisma. Produção deve usar backup verificado e janela curta sem escrita devido aos locks de DDL.

## Endereço operacional, status do orçamento e datas PMOC (2026-07-28)

- `CustomerAddress.referencePoint` foi adicionado como campo opcional, sanitizado e limitado a
  180 caracteres. Migration aditiva: `20260728190000_customer_address_reference_point`.
- Operations continuam apenas referenciando o endereço oficial do cliente; complemento e ponto de
  referência não foram duplicados e não integram o Document Engine.
- O Blueprint de Budget traduz todos os estados oficiais para pt-BR.
- Datas de cobertura e recorrência PMOC são tratadas como datas-calendário em UTC. Horários reais
  de início, conclusão e assinatura continuam formatados em `America/Recife`.

## PMOC, atendimentos e materiais de orçamento — refinamento (2026-07-28)

- A Operation PMOC concluída agora vincula a `MaintenanceExecution` antes dos efeitos de
  conclusão. A migration `20260728180000_pmoc_execution_completion_reconciliation` corrige
  execuções legadas vinculadas a Operations concluídas.
- A projeção por equipamento distingue última execução concluída, próxima solicitação prevista e
  status operacional.
- `GET /assignments/my` prioriza número da Operation, data agendada e atribuição mais recentes.
- `BudgetItem.source` separa `CATALOG` de `MANUAL`. Itens do catálogo têm preço e total
  autoritativamente zerados.
- Migration: `20260728181000_budget_item_source`.

## Catálogos — tipos de equipamento e materiais de orçamento (2026-07-28)

- `TechnicalCatalogType` recebeu `EQUIPMENT_TYPE` e `BUDGET_MATERIAL_DESCRIPTION`.
- `Equipment.equipmentTypeCatalogId` referencia opcionalmente o catálogo oficial. O enum
  `EquipmentType` foi preservado para retrocompatibilidade; tipos personalizados usam `OTHER`.
- A migration cria os nove tipos V1 para cada organização existente e vincula os equipamentos
  legados sem apagar ou reclassificar dados.
- O bootstrap de produção garante os mesmos tipos em bancos onde a organização nasce após migrate.
- Descrições de materiais são consumidas somente na criação do orçamento; `BudgetItem.description`
  continua sendo o snapshot imutável do texto escolhido.
- Migrations aditivas:
  `20260728170000_equipment_and_budget_catalogs` (novos enums, em transação própria) e
  `20260728171000_equipment_type_catalog_relation` (relação, defaults e backfill).

## Operações — valor operacional e complementação técnica (2026-07-28)

- `Operation.serviceValue` foi adicionado por migration aditiva como valor operacional opcional,
  não negativo e com duas casas decimais.
- Somente OWNER/MANAGER podem defini-lo na criação. O valor não pertence ao Financial Core e não é
  entregue ao Document Engine, Preview ou PDF.
- `inspectedEquipments` aceita marca, modelo e capacidade. Durante criação/execução, o serviço
  completa somente campos vazios do equipamento e preserva valores existentes.
- OPERATOR só pode complementar equipamentos já vinculados à própria operação atribuída.
- Auditoria: `EQUIPMENT_PROFILE_COMPLETED_FROM_OPERATION`.
- Migration: `20260728153000_operation_service_value`.

## PMOC — capacidade e encerramento por equipamento (2026-07-28)

- `PmocPlan.plannedExecutionCount` persiste a quantidade de ciclos da cobertura sem multiplicá-la
  no resumo do plano.
- Cada equipamento mantém contador próprio. `equipmentExecutionNumber` começa em `001` para cada
  ativo; `executionNumber` global foi preservado para histórico e retrocompatibilidade.
- A reserva usa lock PostgreSQL por `(PMOC, equipamento)`, limite autoritativo e constraint única.
- Cobertura encerrada com ciclos incompletos fica `OVERDUE`. Depois que todos os equipamentos
  concluem o total previsto, a reconciliação altera o plano para `COMPLETED`.
- Migration aditiva: `20260728113000_pmoc_execution_capacity_per_equipment`.

## PMOC — execução mobile por equipamento e assinatura OWNER (2026-07-27)

- O app Operator não cria nem configura planos PMOC. OWNER escolhe um plano ativo e um equipamento
  coberto, reutilizando a mesma `PmocExecutionRequest` e o mesmo executor individual da Platform.
- A execução preserva o fluxo oficial `PmocPlan → PmocExecutionRequest → Operation →
  MaintenanceExecution → Document Engine`; cada equipamento produz sua própria OS, evidências e
  documento PMOC.
- `Signature.userId` passou a ser configurável no CRUD institucional para vincular uma assinatura a
  um OWNER ativo. O vínculo único por usuário identifica o responsável técnico sem flags paralelas.
- Vários responsáveis técnicos são suportados por vários usuários OWNER, cada qual com sua
  assinatura ativa. Assinatura removida libera o vínculo sem apagar documentos históricos.
- Migration aditiva de dados `20260727213000_link_existing_owner_signature`: instalações com um
  único OWNER recebem automaticamente a assinatura ativa padrão preexistente; instalações com
  múltiplos OWNER exigem associação explícita em Configurações > Assinaturas.
- Nenhum novo endpoint, renderer, Storage ou entidade foi criado.

## PMOC — separação entre configuração e execução, passo 1 (2026-07-27)

- `POST /api/v1/pmoc` aceita o campo aditivo `configurationOnly`.
- Com `configurationOnly=true`, a transação cria somente `MaintenancePlan`, `PmocPlan`, cobertura,
  equipamentos, escopos e checklist. Não cria `MaintenanceExecution`, `PmocExecutionRequest`,
  `Operation`, `Assignment`, Handoff, Preview ou PDF.
- O plano inicia com `lastReservedExecutionNumber=0`, mantém a primeira data prevista em
  `nextExecutionDate` e persiste `nextGenerationDate=null`.
- O modo aceita `MANUAL` (Geração com revisão) ou `PAUSED`; `AUTO` é normalizado para `MANUAL`.
- Endereço, escopo, tipos de serviço, OWNER técnico ativo e assinatura própria ativa desse OWNER
  são validados no backend.
- O contrato anterior permanece compatível quando `configurationOnly` não é enviado.
- Nenhuma entidade ou migration foi criada.

# RVT Planning — configuração e execuções independentes (2026-08-03)

- Criados `RvtPlan`, `RvtPlanEquipment`, `RvtPlanChecklist` e `RvtExecution` como especialização de `MaintenancePlan`/`MaintenanceExecution`; `Operation`, `Assignment` e Document Engine continuam oficiais.
- Migration aditiva `20260803180000_rvt_planning_foundation`; numeração monotônica por cliente com advisory lock e transação `SERIALIZABLE`.
- Configurar/editar não emite documento. `POST /rvt-executions/:id/prepare` materializa a Operation `TECHNICAL_REPORT` somente no início/atribuição.
- Conclusão da Operation sincroniza a ocorrência e encerra a configuração quando não restam execuções abertas.
- RVT avulso concluído pelo Operator é registrado idempotentemente por `/rvt-plans/ad-hoc`.
- Assinatura do cliente é opcional no RVT; assinatura técnica ativa do responsável configurado permanece obrigatória.
- Equipamento encontrado durante RVT configurado é vinculado ao cliente, Operation e configuração na mesma transação.

# Múltiplos equipamentos na OS avulsa — 2026-08-03

- `POST /api/v1/customers/walk-in` aceita `equipments[]` (1–20) e cria cliente pendente de revisão,
  endereço, contato e todos os equipamentos em uma única transação.
- Cada equipamento recebe tipo do Catálogo Técnico, QR Code próprio e vínculo com o mesmo
  cliente/endereço. A resposta inclui `equipments[]`; `equipmentId` e `equipmentName` permanecem
  como aliases do primeiro item para retrocompatibilidade.
- O payload singular legado `equipment` continua aceito. Nenhuma migration ou entidade foi criada.

## Cliente 360 — métricas operacionais contextualizadas (2026-07-23)

- `GET /operations/stats` aceita `customerId` opcional e calcula todos os estados somente para o cliente selecionado.
- O filtro é combinado com `OperationAccessService.operationScope`; nenhuma métrica pode ampliar o conjunto autorizado ao ator.
- CRUD de contatos e criação de Operation permanecem nos serviços oficiais existentes. Nenhuma entidade ou migration foi criada.

## Recibo originado por venda — declaração comercial (2026-07-23)

- `GET /sales/:id/receipt-prefill` passou a incluir CPF/CNPJ do cliente e a origem explícita `SALE`.
- O prefill preserva sempre os itens vendidos e acrescenta as observações da venda, em vez de substituir os produtos pelas observações.
- A declaração automática distingue venda de produtos de prestação de serviços e identifica o cliente por nome e CNPJ/CPF.
- O fallback do `DocumentBuilder` aplica a mesma semântica usando `Operation.sourceSaleId`; declarações editadas e snapshotadas continuam imutáveis.
- Nenhuma entidade, migration, renderer ou fluxo documental paralelo foi criado.

## PMOC → Ordem de Serviço operacional (2026-07-23)

- A geração manual continua usando exclusivamente `PmocExecutionRequest`; selecionar uma execução na Platform carrega o prefill e a OS só é persistida após a revisão do wizard oficial.
- Cliente, endereço, equipamentos cobertos, identidade/número da execução e vínculo com o plano são autoritativos no backend. Operador, agenda, textos e procedimentos podem ser revisados antes da geração.
- O checklist selecionado no PMOC agora gera também o snapshot estruturado `OperationMaintenanceChecklistItem`, multiplicado pelos equipamentos cobertos. É esse snapshot que o Operator executa e que o documento PMOC consome.
- `Operation.checklist` foi preservado para compatibilidade com a OS. `Operation.inspectedEquipments` sempre recebe toda a cobertura do PMOC e não pode ser reduzido pelo payload revisado.
- A criação pela `OperationsService` mantém Assignment, MaintenanceExecution, auditoria e vínculo da Execution Request na mesma transação oficial.
- Nenhuma entidade ou migration foi criada.

## RVT e PMOC — checklists oficiais do Catálogo Técnico (2026-07-22)

- RVT persiste o tipo realizado em `Operation.maintenanceType` e os grupos Semanal/Semestral em `OperationMaintenanceChecklistItem`; ambos seguem no mesmo Blueprint, com apenas o realizado marcado.
- O Blueprint do RVT foi consolidado em Identificação (incluindo Técnico em Campo), Cliente com endereço, Equipamentos, Tipo de Manutenção, Observações, Recomendações opcionais, Evidências e Assinaturas.
- `PmocPlanChecklist` referencia itens `TechnicalCatalog(CHECKLIST)` selecionados para o plano. `includeChecklistInOperations` permite ao OWNER não enviar checklist.
- A OS gerada recebe um snapshot dos itens selecionados; mudanças futuras no catálogo ou plano não reescrevem Operations existentes.
- Migration aditiva: `20260722233000_pmoc_official_checklist`.
- Validação: 89 unitários e 14 integrações PostgreSQL aprovados; lint/build backend e frontend aprovados.

## Gestão — Execuções dos Operadores (2026-07-22)

- A projeção read-only `OperatorExecutionsService` calcula indicadores exclusivamente a partir de `Assignment.assignedTo` e `Operation`; nenhuma comissão, meta ou contador derivado é persistido.
- Endpoints mensais: `GET /operator-executions`, `GET /operator-executions/:operatorId` e `GET /operator-executions/:operatorId/operations`.
- A visão compara atendimentos, concluídos, pendentes, em execução, atrasados, cancelados, taxa de conclusão e tempo médio. O detalhe oferece histórico e agenda paginados.
- Competências respeitam `OrganizationSettings.timezone`. OWNER/MANAGER possuem acesso; OPERATOR/VIEWER não recebem métricas de terceiros.
- Migration `20260722213000_operator_execution_metrics_indexes` adiciona índices de conclusão por executor e agenda/status, sem alterar entidades ou dados.

## Operator — conclusão direta de OS e Visita Técnica (2026-07-22)

- O Operator pode iniciar autonomamente apenas `WORK_ORDER` e `TECHNICAL_REPORT`; outros tipos exigem criação e atribuição pela gestão.
- A conclusão do Assignment para esses dois tipos move a Operation diretamente para `COMPLETED`, publica os efeitos oficiais de conclusão e notifica OWNER/MANAGER.
- Tipos especiais atribuídos continuam terminando em `REVIEW`, sem alteração do workflow existente.
- O Operator atribuído pode finalizar o Handoff e renderizar somente OS/RVT já concluídas por ele. Preview, Renderer, PDF Engine, Storage e download permanecem os oficiais.
- A preparação do Handoff agora resolve assinatura e stale state pelo documento do tipo solicitado, evitando que a OS automática interfira no RVT.
- Nenhuma entidade ou migration foi criada.

## PMOC — confirmação de cobertura ativa (2026-07-22)

- A criação consulta previamente coberturas PMOC ativas do cliente pelo endpoint `GET /api/v1/pmoc/active-coverage`.
- Cobertura ativa significa PMOC e plano de manutenção ativos, com a data atual entre `startDate` e `endDate` (inclusive). Pausar gerações não encerra a cobertura.
- Um segundo PMOC continua permitido, mas exige confirmação explícita com `confirmActiveCoverage: true`; sem ela, a API responde `409 PMOC_ACTIVE_COVERAGE_CONFIRMATION_REQUIRED`.
- A confirmação é registrada de forma append-only em `AuditLog` como `PMOC_ACTIVE_COVERAGE_CONFIRMED`, incluindo os PMOCs ativos identificados.
- Não houve alteração de entidades nem migration.

## ORBIT_SECURITY_FIX01 — ownership do Operator certificado (2026-07-18)

- `Assignment` vigente passou a ser a única autoridade para o acesso operacional do papel
  `OPERATOR`; `operation.operatorId`, filtros do frontend e identificadores recebidos na requisição
  não autorizam acesso.
- O novo `OperationAccessService` centraliza escopos Prisma e assertions para Operation, fotos,
  documentos, Handoff, MaintenanceExecution, Asset Lifecycle, materiais, movimentações e exports.
- São válidos para leitura operacional os estados `ASSIGNED`, `ACCEPTED`, `STARTED`, `PAUSED` e
  `COMPLETED`. `REJECTED` e `CANCELED` revogam acesso e chamadas diretas retornam `403` sem payload
  parcial.
- O Repositório Documental e todas as listagens afetadas aplicam o ownership no SQL; não há
  pós-filtro no frontend. Documentos sem Operation também são negados ao Operator.
- Toda negação do resolvedor central registra `OPERATOR_ACCESS_DENIED` em `AuditLog`, com instalação,
  usuário, role, recurso, ID, motivo e request ID, sem paths, chaves de Storage ou binários.
- Nenhuma entidade ou migration foi criada. A máquina de estados de Assignment/Operation e os
  contratos funcionais de PMOC, Handoff, Receipt, Budget e Document Engine foram preservados.
- Certificação: unitários 17 suites/80 testes, segurança 13/55, integração PostgreSQL 3/12 e
  concorrência 2/24 aprovados. Relatório:
  `docs/release/ORBIT_SECURITY_FIX01_OPERATOR_OWNERSHIP.md`.

## DC-05 — Recibo / Garantia certificado (2026-07-18)

- `RECEIPT` reutiliza o Document Engine oficial; não houve domínio, renderer, PDF ou Storage paralelo.
- `Operation` recebeu snapshots aditivos de número/data, valor numérico e por extenso, serviço,
  descrição, garantia e declaração final editável.
- Recibo manual não cria OS documental artificial; a origem por OS reutiliza uma Operation concluída.
- O Blueprint contém identificação, declaração, garantia e somente a assinatura técnica selecionada.
- OWNER/MANAGER podem emitir; OPERATOR/VIEWER não acessam. Migration:
  `20260718170000_dc05_receipt_certification`.
- Runtime certificado em `REC-000057`: PDF válido (15.316 bytes) e Repositório confirmado. Unitários
  85/85, integração 12/12 e concorrência 24/24. A suíte global de segurança mantém uma falha PMOC
  preexistente e reproduzível (48/49), documentada no relatório DC-05 como risco fora do escopo.


## PMOC — evidências e identidade da coleta consolidadas (2026-07-18)

- O Handoff oficial agora prioriza `PmocPlan.signatureOverrideId` ao preparar o documento da
  execução; sem override, permanece o resolvedor institucional existente.
- Fotos continuam pertencendo exclusivamente à `Operation` e assinatura do cliente ao snapshot do
  `OperationDocument`; nenhuma entidade, migration ou storage paralelo foi criado.
- `collectedBy` permanece a fonte autoritativa do usuário que coletou/substituiu a assinatura.
- Teste PostgreSQL cobre a prioridade do override PMOC no Handoff oficial.

## PMOC UX-02.1 — fechamento do fluxo crítico (2026-07-17)

- A política de assinatura PMOC continua governada pelo `DocumentTemplate`: o Wizard e o Operator
  consomem a projeção pública sanitizada de `DocumentConfiguration`; OPERATOR pode consultar apenas
  o tipo `PMOC`, sem acesso à listagem geral ou aos demais tipos.
- A emissão final PMOC exige quatro fotos oficiais da `Operation`. `Assignment.complete`, conclusão
  direta da Operation e `DocumentEngine.renderDocument` retornam `409 PMOC_EVIDENCE_REQUIRED`
  enquanto a quantidade mínima não for atingida; salvamento parcial permanece permitido.
- Uploads PMOC aceitam somente PNG/JPEG até 5 MiB, validam MIME e assinatura binária e continuam
  persistidos por `OperationPhoto` + `StorageProvider`.
- `DocumentBuilder` diferencia `NÃO ASSINADO`, `ASSINADO INSTITUCIONALMENTE`, `ASSINADO` e
  `SEM ASSINATURA EXIGIDA`; COLLECTED/HYBRID sem coleta recebem aviso explícito no Blueprint.
- Downloads de documentos e orçamentos agora são binários `application/pdf`, sem Base64 no payload.
  Stale detection, RBAC, auditoria e resolução via `DocumentAssetResolver` foram preservados.
- A projeção das Execution Requests inclui `signedAt` e contagem de fotos. O prefill oficial e a
  relação `OperationInspectedEquipment` preservam todos os equipamentos do PMOC.
- Nenhuma migration foi criada; o schema existente já representava fotos, múltiplos equipamentos,
  assinatura/override e documentos.

## PMOC UX-02 — refinamento profissional (2026-07-16)

- `TechnicalCatalogType.PLAN_SCOPE` estrutura o escopo usando o Catálogo Técnico oficial;
  `PmocPlanScope` associa planos e itens sem duplicar CRUD ou taxonomia.
- `coverage` permanece como snapshot textual compatível, derivado dos títulos selecionados; os
  contratos aceitam `scopeCatalogIds` e validam tipo, atividade e organização no backend.
- `GET /api/v1/pmoc/name-suggestion?customerId=...` oferece sugestão provisória. Sem edição manual,
  o backend recalcula o nome definitivo após reservar o número oficial.
- O reagendamento individual permanece no `PmocExecutionRequest`: preserva identidade, número,
  `MaintenanceExecution`, histórico e auditoria sem alterar periodicidade ou demais requests.
- Migrations aditivas `20260716223000_pmoc_ux02_plan_scope` e
  `20260716223100_pmoc_ux02_plan_scope_catalog`; 15 escopos padrão por organização.
- Runtime real validou Catálogo → PMOC → ExecutionRequest → Operation → Assignment → Document
  Engine, PDF de 18.957 bytes e presença em `/documentos`.

## PMOC Foundation — Bloco 3 (2026-07-16)

- `GET /pmoc/stats` tornou-se a projeção operacional oficial do dashboard: planos ativos, pausados
  e vencidos; requests previstas no mês, concluídas, pendentes, canceladas e falhas; calendário,
  próximas e últimas execuções. Todos os indicadores são calculados no PostgreSQL/backend.
- `GET /pmoc` e `GET /pmoc/:id` adicionam `overview` com progresso, execuções restantes, atraso
  médio, última OS, último documento e saúde determinística do plano.
- O histórico PMOC consolida, sem duplicar persistência, os logs append-only de `PmocHistory`,
  `AssignmentHistory`, documentos renderizados e auditoria de assinatura da Operation.
- Requests retornam o documento PMOC relacionado. Calendário e listas carregam cliente,
  equipamentos, OS e documento em queries agregadas, sem N+1.
- Período do calendário é validado e limitado a 370 dias; o retorno é limitado a 500 requests.
- Nenhuma migration ou entidade foi necessária. Operation, Assignment, MaintenanceExecution,
  Scheduler, Notification Center e Document Engine permanecem inalterados.
- Certificação final: Prisma validate/generate, lint/build backend e frontend, 81 testes unitários,
  8 de integração PostgreSQL, 24 de concorrência e 47 de segurança aprovados. Runtime Docker com
  45 migrations sincronizadas e API, PostgreSQL e Storage saudáveis.

## PMOC Foundation — Bloco 2 (2026-07-16)

- `PmocPlan` concentra os defaults operacionais da OS: endereço, tipo, duração estimada e
  observações, além de operador/técnico já oficiais. Esses dados alimentam o prefill do
  `OperationCreationDrawer`; não criam Operation, Assignment ou agenda paralela.
- Cada `PmocExecutionRequest` preserva snapshots de operador e técnico planejados. Alterar defaults
  afeta apenas novas execuções, salvo confirmação explícita para propagar às solicitações
  `PENDING/FAILED`; execuções geradas, canceladas ou concluídas permanecem imutáveis.
- Reagendamento oficial reutiliza a mesma solicitação e o mesmo `executionNumber`, atualiza a
  `MaintenanceExecution` relacionada e acrescenta histórico/auditoria append-only.
- O detalhe de Operation/Assignment expõe contexto PMOC aditivo, permitindo que Platform e
  Operator mostrem plano, execução, periodicidade e responsabilidade sem consultas paralelas.
- Migration aditiva: `20260716190000_pmoc_professional_operational_defaults`.
- Novo endpoint: `PATCH /api/v1/pmoc/execution-requests/:id/reschedule`.
- A Central de Relatórios encaminha novas gestões PMOC para `/pmoc`; emissão e documentos
  históricos continuam no Document Engine oficial.
- Certificação: Prisma validate/generate, backend lint/build, 81 unitários, 8 integrações, 24 de
  concorrência e 46 de segurança aprovados. Runtime Docker com 45 migrations, API/storage/database
  saudáveis e 0 endereço padrão cruzado entre clientes.

## PMOC Foundation — Bloco 1.1 (2026-07-16)

- Cada `PmocExecutionRequest` possui `executionNumber` monotônico por PMOC, `executionYear`,
  `generatedOperationId` e `generatedAt`; a OS mantém numeração própria e independente.
- `PmocPlan.lastReservedExecutionNumber` é incrementado atomicamente no PostgreSQL. A constraint
  `(pmocPlanId, executionNumber)` impede duplicação e números cancelados nunca retornam ao pool.
- Projeções autoritativas persistidas: última execução, último número gerado, próxima execução,
  próxima geração, última geração bem-sucedida e estado/erro/horário do scheduler.
- Geração manual e retry alteram a solicitação já reservada; nunca criam execução substituta.
- Conclusão de `MaintenanceExecution` atualiza `lastExecutionDate` e adiciona uma ocorrência única
  `EXECUTION_COMPLETED` ao histórico append-only.
- Histórico retorna projeção aditiva com execução, OS, status, datas, operador e técnico.
- Migrations: `20260716170000_pmoc_foundation_block_1_1` e
  `20260716171000_pmoc_completion_history_integrity`, com backfill determinístico.
- Certificação: Prisma validate/generate/migrate aprovados; backend lint/build e 81 testes unitários;
  8 testes de integração, 24 de concorrência, 45 de segurança e 11 cenários focados do PMOC.
- Runtime Docker: 44 migrations sincronizadas; 5 solicitações preexistentes migradas com 0 número
  inválido, 0 sequência duplicada e 0 referência de Operation divergente; API saudável.
- Veredito: `ORBIT_PMOC_FOUNDATION_BLOCK_1_1_READY`.

## PMOC Foundation — Bloco 1 (2026-07-16)

- PMOC é oficialmente um plano preventivo especializado sobre `MaintenancePlan`; o documento PMOC
  continua sendo consequência de uma `Operation` executada e não houve alteração no Document Engine.
- `PmocPlan` recebeu cobertura, periodicidade oficial, modo `AUTO | MANUAL | PAUSED`, operador e
  técnico padrão opcionais, assinatura override opcional e status operacional.
- `PmocExecutionRequest` representa cada solicitação planejada nos estados `PENDING`,
  `GENERATING_OS`, `GENERATED`, `FAILED` e `CANCELLED`; referências para MaintenanceExecution e
  Operation preservam rastreabilidade sem duplicar execução.
- `PmocHistory` é append-only e registra criação, alterações de periodicidade/operador/cobertura,
  solicitações, falhas, cancelamentos e OS automáticas/manuais.
- `PmocSchedulerService` é o único entry point do scheduler. Não depende de cron; um adapter futuro
  apenas chamará `run()`.
- Geração de OS utiliza `OperationsService` com hook transacional. Se o vínculo PMOC falhar, toda a
  Operation, Assignment e OS rascunho são revertidas e a solicitação fica `FAILED`.
- O RecurringEngine calcula a próxima solicitação após geração bem-sucedida. Não existe calendário,
  agenda, Assignment ou renderer paralelo.
- Notification Center recebeu somente os três eventos definidos: OS PMOC gerada, falha de geração
  e execução manual pendente.
- Migration aditiva: `20260716160000_pmoc_foundation_block_1`, com backfill de periodicidade,
  status, solicitações e histórico para PMOCs existentes.
- Certificação: Prisma validate/generate, lint e build aprovados; 81 testes unitários, 8 de
  integração, 24 de concorrência, 44 de segurança e 10 cenários focados do PMOC aprovados.
- Runtime Docker: 42 migrations aplicadas, API saudável com PostgreSQL conectado e storage
  disponível; imagens de API e Platform reconstruídas com o código desta entrega.

## DC-03.1 — enriquecimento do Laudo Técnico (15/07/2026)

- A seção Solicitante passou a usar os dados já resolvidos no DocumentContext: nome fantasia,
  razão social, CNPJ/CPF, contato principal e endereço completo.
- Operation recebeu snapshots de `technicalOpinionResponsible` e `technicalOpinionCrea`,
  preenchidos pelo wizard e usados na identificação do Laudo com fallback compatível para a
  assinatura institucional configurada.
- `OperationInspectedEquipment` recebeu snapshots de tipo de sistema e situação atual. A tabela
  certificada agora usa Nº, Modelo/Capacidade, Tipo de Sistema, Local de Instalação e Situação Atual.
- Migration: `20260715100000_technical_opinion_requester_responsibility_equipment`.
- Preview e PDF continuam derivados do mesmo Blueprint; nenhum endpoint ou renderer foi criado.
- Runtime PostgreSQL: `LDO-000024`, dois equipamentos, PDF válido com 23.423 bytes e registro
  confirmado no catálogo `/documents`.

## DC-03 — certificação do Laudo Técnico (14/07/2026)

- `TECHNICAL_OPINION` foi especializado no fluxo oficial Context → Builder → Blueprint →
  LayoutEngine → Renderer → PdfEngine → Storage; nenhum caminho documental paralelo foi criado.
- Operation recebeu campos próprios para objetivo, condições observadas, análise e conclusão do
  Laudo, impedindo que uma mesma Operation reutilize acidentalmente conteúdo de
  `TECHNICAL_REPORT`.
- Estrutura certificada: identificação, solicitante, objetivo, descrição dos equipamentos,
  condições observadas, análise técnica, conclusão e assinatura.
- A tabela reutiliza `OperationInspectedEquipment` com equipamento, marca, modelo, capacidade,
  série e local; checklist, materiais, fotos, QR, timeline e documentos relacionados são excluídos.
- Responsável Técnico e CREA vêm da assinatura institucional configurada no template; os modos
  NONE/FIXED/COLLECTED/HYBRID permanecem autoridade do `DocumentContext`.
- O Renderer passou a medir e quebrar células de tabela genericamente, inclusive identificadores
  sem espaços, mantendo a mesma semântica no Viewer e no PDF.
- Migration: `20260714153000_technical_opinion_certification`.
- Runtime local: `LDO-000022`, duas páginas, dois equipamentos, HYBRID com duas assinaturas, PDF
  válido e registro confirmado em `/documents`.

## Work Order — criação independente e estrutura consolidada (14/07/2026)

- A Central de Relatórios agora pode reutilizar uma Operation concluída ou criar uma OS do zero.
- “Do zero” continua criando uma Operation `DRAFT` oficial; o `OperationDocument` WORK_ORDER é
  criado pela transação já existente. Não foi criado domínio, endpoint ou renderer paralelo.
- A OS utiliza `inspectedEquipments` para uma tabela com múltiplos equipamentos e snapshots de
  setor, marca, modelo e capacidade.
- A estrutura oficial passou a ser: identificação, cliente, equipamentos, solicitação,
  serviços/checklist, observações, fotos opcionais e assinatura.
- Materiais e documentos relacionados foram removidos exclusivamente da OS.
- Evidências existentes são omitidas quando vazias e, quando presentes, utilizam o novo componente
  aditivo `imageGallery`, com duas colunas no Preview e no PDF.
- Sem migration.

## Work Order — remoção do QR gráfico

- `WORK_ORDER` não inclui mais `QrCodeComponent`; a seção `Equipamento` mantém somente o campo
  textual `Código QR` com o identificador persistido.
- O `DocumentContext` não gera mais PNG de QR para Ordem de Serviço, evitando asset sem consumidor
  e a página isolada provocada pelo bloco gráfico.
- Lookup/scanner do equipamento e QR nos demais fluxos permanecem inalterados. Sem migration e sem
  endpoint novo.

## DC-02 — refinamento estrutural do Relatório de Visita Técnica (14/07/2026)

- Cabeçalho oficial ampliado de 96 para 168 pt e reorganizado em duas linhas: logo isolada na
  primeira; título/número à esquerda e dados institucionais quebráveis à direita na segunda.
- O Renderer replica as proporções do Preview: 30 pt de padding após a faixa, linha de logo de
  38 pt, intervalo de 12 pt e alinhamento superior exato entre título e empresa.
- Ordem semântica do `TECHNICAL_REPORT`: identificação, cliente, local, equipamentos em tabela,
  período, checklist da periodicidade selecionada, objetivo, diagnóstico, atividades, checklist
  complementar, recomendações, observações e assinatura.
- A seção passou a se chamar `Equipamentos` e mantém as colunas `ITEM`, `SETOR`, `MARCA`, `MODELO`
  e `CAPACIDADE`; quando não existe seleção múltipla, utiliza o equipamento principal como fallback.
- QR individual, materiais, fotos e documentos relacionados foram removidos exclusivamente deste
  modelo. O Context não resolve esses assets para `TECHNICAL_REPORT`, evitando I/O sem consumo.
- Sem migration ou alteração de endpoint.

## Refinamento visual — cabeçalho e rodapé documental

- Logo centralizada verticalmente entre a faixa institucional e a linha inferior do cabeçalho em
  todas as páginas renderizadas.
- `Blueprint v1.0` permanece metadado interno, mas foi removido do rodapé público; o documento
  exibe apenas identificação institucional e documental.
- Preview/PDF permanecem no fluxo oficial. Sem migration ou alteração de endpoint.

## Correção — payload de evidências de Operation

- O parser JSON padrão de aproximadamente 100 KiB foi substituído por limites explícitos e
  configuráveis.
- `/api/v1/operations` possui limite isolado de 120 MiB, suficiente para o contrato existente de
  até 16 fotos de 5 MiB em Data URL mais assinatura e conteúdo técnico.
- As demais rotas permanecem limitadas a 1 MiB para não ampliar globalmente o consumo de memória.
- Erros do body parser agora retornam `413 UPLOAD_FILE_TOO_LARGE` no envelope oficial, em vez de
  `500 INTERNAL_SERVER_ERROR`.
- Request ID passou a ser atribuído antes do parser e permanece estável no restante do pipeline.
- Variáveis: `HTTP_JSON_BODY_LIMIT_BYTES` e `OPERATION_JSON_BODY_LIMIT_BYTES`. Sem migration.

## DC-02 — certificação do Relatório de Visita Técnica

- `TECHNICAL_REPORT` foi certificado sobre o fluxo oficial Context → Builder → Blueprint →
  LayoutEngine → Renderer → PdfEngine → Storage.
- Operation recebeu `technicalDiagnosis` e `technicalRecommendations`; `reportedIssue`,
  `serviceDescription` e `observations` preservam objetivo, atividades e observações finais.
- A estrutura descrita nesta certificação foi refinada em 14/07/2026 conforme o bloco mais recente
  deste documento.
- narrativas reconhecem parágrafos, quebras de linha e listas; blocos textuais longos agora são
  quebrados genericamente pelo Renderer sem regra específica de relatório.
- política NONE/FIXED/COLLECTED/HYBRID permanece resolvida no DocumentContext; o Builder não busca
  assinatura.
- Preview e PDF runtime do `RVT-000015` apresentaram as mesmas quatro páginas, QR, foto, Unicode e
  duas assinaturas; registro confirmado em `GET /documents`.
- migration: `20260713110000_technical_report_certification`.

## Product Backlog Closure 07 — Central de Relatórios

- Os workflows WORK_ORDER, TECHNICAL_REPORT, TECHNICAL_OPINION, PMOC e RECEIPT continuam baseados em Operation e no Document Engine oficial; nenhum renderer/contexto paralelo foi criado.
- Builders especializados agora usam objetivo/diagnóstico (`reportedIssue`), análise/medições/dados de recebimento (`serviceDescription`) e conclusão/pendências (`observations`).
- PMOC criado pela Central vincula a Operation a uma MaintenanceExecution oficial.
- Render runtime dos cinco tipos gerou PDFs válidos e todos apareceram em `GET /documents`.
- Sem migration e sem endpoint backend novo.

## DC-01.2 — paridade visual, QR real e assinatura técnica

- Refinamento posterior: cabeçalho PDF alinhado ao Preview, espaçamento vertical ampliado e quebra
  preferencial da WORK_ORDER após Equipamento.
- `FIXED` agora exclui categoricamente assinaturas de execução, mesmo diante de flags residuais no
  template; checklist concluído recebe marca gráfica visível no PDF.
- `QrCodeComponent` passou a carregar a imagem PNG gerada a partir do `Equipment.qrCode` oficial;
  o PDF e o Preview consomem o mesmo componente do Blueprint.
- `DocumentAssetResolver` é a única camada que gera e resolve o QR; Builder e Renderer não acessam
  Storage nem banco.
- O Blueprint publica tokens visuais compartilhados; Viewer e PDF alinham cores, tipografia,
  superfícies, metadados, tabelas, checklist e assinaturas.
- `HYBRID` combina a assinatura institucional exata configurada no template com a assinatura
  coletada da execução, incluindo nome, cargo, conselho e departamento.
- Runtime local real confirmou equipamento via lookup do payload, material consumido, QR rasterizado
  decodificável, duas assinaturas e PDF válido. Nenhuma migration foi criada.

## DC-01 — certificação da Ordem de Serviço

- WORK_ORDER agora segue identificação → cliente → equipamento → defeito → serviços → checklist →
  materiais → observações → fotos → assinaturas.
- Operation recebeu `reportedIssue` e `serviceDescription`.
- Organization recebeu endereço institucional e website opcionais.
- logo é resolvida pelo DocumentAssetResolver e entregue no Blueprint/header.
- Renderer mantém título da seção junto ao primeiro bloco e formata data de assinatura em pt-BR.
- Migration: `20260711210000_work_order_certification`.
- Runtime real confirmou a ordem das oito seções, assinatura, Unicode, PDF `%PDF-`, stale/re-render e
  paginação sem título de seção órfão.

## Document Engine D1 — catálogo e políticas de assinatura

- `OperationDocument` alimenta diretamente o novo `GET /documents`, catálogo oficial paginado para
  documentos de Operation e Budget.
- filtros: tipo, cliente, equipamento, operador, período, status e busca textual.
- `DocumentTemplateSignature` permite múltiplas assinaturas institucionais ordenadas; `signatureId`
  permanece como fallback compatível.
- Template recebeu políticas de execução para cliente, técnico e operador; Signature recebeu
  conselho profissional e departamento.
- DocumentContext entrega assinaturas institucionais e de execução resolvidas; Builder não consulta
  Prisma nem Storage.
- Migration: `20260711193000_document_catalog_signature_policies`.
- Validação PostgreSQL: integração 7/7, concorrência 24/24 e AppSec focado 7/7.

## Product Backlog Closure 06.1 — runtime PDF parity and Unicode

Status: concluída em 11 de julho de 2026 após render/download reais em Docker local.

- PDF adapter migrado para PDFKit com Noto Sans incorporada (Unicode, OFL).
- Renderer ganhou fundo branco, cor primária em seções e superfícies equivalentes ao preview.
- O documento corrente não entra mais em “Documentos relacionados”, evitando stale autorreferente.
- Runtime confirmou `WORK_ORDER`, template `162d3c80…`, assinatura visível, PDF `%PDF-` e texto
  português extraível.
- Mutation posterior retornou `409 DOCUMENT_STALE`; re-render e download atual passaram.
- Validação final: build/lint; 16 suítes/47 testes padrão; 2 suítes/7 testes de integração; 2
  suítes/24 testes de concorrência; e 2 suítes/7 testes AppSec focados foram aprovados.
- A suíte AppSec agregada conserva uma falha preexistente de isolamento entre specs (ator removido e
  sessão revogada compartilhados); as suítes de Document Engine e Signatures passam isoladamente.
- Nenhuma migration.

## Product Backlog Closure 06 — Work Order runtime consistency

Status: concluída em 11 de julho de 2026, sem migration.

- Corrigido retorno prematuro de `OperationsService.update`; evidências são concluídas antes da
  resposta e a Operation autoritativa é recarregada.
- Preview/render de documentos recebem `sourceFingerprint` SHA-256 sem timestamps voláteis.
- `renderMetadata.sourceFingerprint` identifica exatamente a fonte usada no PDF.
- Download reconstrói a fonte atual e retorna `409 DOCUMENT_STALE` quando o PDF persistido é antigo.
- `WORK_ORDER` continua usando exclusivamente Operation → DocumentContext → Builder → Renderer → PDF.
- Testes focados: 12 passaram; assinatura aparece no blueprint e no PDF.

Validação final: Prisma validate/generate, build e lint passaram; suíte completa passou com 16
suites/47 testes. Suítes integration/concurrency/security com PostgreSQL dedicado não foram
executadas porque o daemon Docker local estava indisponível.

Reprodução PostgreSQL via Docker não ocorreu porque o daemon local estava indisponível; o defeito foi
rastreado conclusivamente por serviço e testes de pipeline, sem uso de banco de produção.

## Product Backlog Closure 05 — Reports Preview/PDF and Execution Signature Consistency

Status: concluída em 10 de julho de 2026.

Correções aplicadas sem migrations:

- `DocumentContextService` agora hidrata a assinatura capturada na execução (`Operation.signatureData`)
  como assinatura coletada oficial para `WORK_ORDER`, `TECHNICAL_REPORT`, `REPORT` legado e
  `RECEIPT`.
- A assinatura executada é validada como data URL PNG/JPEG, com checagem binária e limite de 2 MiB,
  antes de entrar no contexto documental.
- `DocumentBuilderService` preserva a imagem da assinatura coletada no `SignatureComponent`;
  `DocumentViewer` e PDF Engine passam a consumir o mesmo blueprint.
- `renderMetadata` dos documentos renderizados recebeu proveniência do blueprint:
  `sourceKind`, `sourceId`, `templateId`, `templateUpdatedAt`, `documentType` e `documentNumber`.
- `OperationsService` passou a normalizar/validar `signatureData` na criação da Operation, evitando
  persistência de assinatura inválida.

Validação executada:

- `backend npm run build`: passou.
- `backend npm run lint`: passou.
- `backend npm test -- --runInBand backend/test/document-engine.spec.ts`: 7 testes passaram.

Nenhuma migration foi criada.

## Product Backlog Closure 05.1 — Platform Visit Report Workflow Consolidation

Status: concluída em 10 de julho de 2026.

Decisão arquitetural: `/reports/visita` era uma implementação paralela/legada de coleta de
evidências de Operation. A rota foi consolidada como interface Operation-bound.

Alterações:

- `PATCH /operations/:id` aceita evidências oficiais: `photos[]`, `signatureData`, `signedAt`,
  checklist e observações.
- Fotos são persistidas como `OperationPhoto` via StorageProvider.
- `DocumentContextService` resolve fotos persistidas por `DocumentAssetResolver`.
- `DocumentBuilderService` emite componentes `image` com conteúdo seguro para preview/render.
- `DocumentRendererService` e `DocumentViewer` renderizam a imagem real quando presente no
  blueprint.
- `/reports/visita` seleciona Operation real, salva evidências e usa `DocumentViewer` para
  `TECHNICAL_REPORT`.

Validação:

- `backend npm run build`: passou.
- `backend npm run lint`: passou.
- `backend npm test -- --silent`: 16 suites / 44 testes passaram.
- `frontend npm run build`: passou.
- `frontend npm run lint`: passou com 2 warnings pré-existentes.
- `npx prisma generate`: passou.
- `DATABASE_URL=... npx prisma validate`: passou.
- `git diff --check`: passou.

Nenhuma migration foi criada.

## Sprint 21 — Performance, Load & Observability

Status: concluída em 6 de julho de 2026.

Sprint 21 não adicionou domínio de negócio. O foco foi medir, corrigir e documentar performance,
carga e observabilidade para a reta final da V1.

### Performance budgets V1

Budgets oficiais para baseline local/staging:

| Área                             |                                 Budget V1 |
| -------------------------------- | ----------------------------------------: |
| Health/readiness                 |                              p95 ≤ 100 ms |
| Listagens paginadas críticas     |                              p95 ≤ 300 ms |
| Mutations transacionais críticas |                              p95 ≤ 500 ms |
| Document preview/render simples  |                              p95 ≤ 800 ms |
| Dashboard executivo atual        | p95 ≤ 1.200 ms por fan-out completo local |
| Error rate em carga controlada   |                  0% para cenários felizes |
| Deadlocks PostgreSQL             |                                         0 |

### Tooling criado

- `backend/test/performance/scripts/seed-performance-data.mjs`: fixture realista opcional para
  performance, idempotente e protegido por banco `_test`/`_perf`.
- `backend/test/performance/scripts/run-performance-scenarios.mjs`: runner HTTP com cenários
  representativos e proteção contra execução acidental em produção.
- `backend/test/performance/scripts/profile-critical-queries.mjs`: profiling PostgreSQL com
  `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)`.
- `backend/test/performance/README.md`: procedimento de uso.

### Cenários medidos

Baseline local em `orbit_perf_test`, fixture `tiny`, API local, 2 VUs, 8 segundos por cenário:

| Cenário                                 | Requests |       p95 | Error rate |
| --------------------------------------- | -------: | --------: | ---------: |
| Dashboard executivo                     |    1.564 | 181.06 ms |          0 |
| Operations/Assignments dispatch         |      332 |  36.62 ms |          0 |
| Inventory consumption                   |      396 |  58.39 ms |          0 |
| Procurement receipt                     |      360 | 117.54 ms |          0 |
| Financial settlement                    |      450 |  45.32 ms |          0 |
| Budget lifecycle                        |      402 |  31.30 ms |          0 |
| Document Engine preview/render/download |      300 | 104.04 ms |          0 |
| Operator read path                      |      420 |  28.31 ms |          0 |

### Correções aplicadas por medição

- `InventoryService` agora aplica retry limitado para conflitos serializáveis PostgreSQL (`P2034`)
  em movimentos de estoque e consumo/retorno de material.
- `ProcurementService` agora aplica retry limitado para conflitos serializáveis (`P2034`) no
  recebimento de compras e transições críticas.
- O runner de carga deixou de reutilizar lançamentos/pedidos já finalizados e passou a criar
  recursos próprios para medir fluxos felizes reais.
- O cenário Operator reutiliza token do operador e não gera falsos positivos de rate limit por
  login repetido.

### PostgreSQL profiling

`EXPLAIN ANALYZE` das queries críticas ficou sub-millisecond no fixture local. Maiores tempos
observados:

- Financial stats core: 0.239 ms;
- Executive dashboard assignments: 0.208 ms;
- Financial entries list: 0.200 ms;
- Stock movements list: 0.151 ms;
- Equipment lifecycle: 0.150 ms.

Inspeção pós-carga:

- conexões: 2 active, 13 idle;
- locks pendentes: nenhum bloqueio não concedido;
- deadlocks: 0.

### Observability

- `GET /api/v1/health/live`: liveness sem dependência de banco.
- `GET /api/v1/health/ready`: readiness com banco e storage.
- `GET /api/v1/metrics`: métricas Prometheus text/plain, sem envelope JSON.
- Métricas registradas: contadores HTTP, erros HTTP, buckets de duração HTTP, renderização de
  documentos, upload/download e mutações críticas de Inventory/Financial/Procurement.

### Decisões

- O dashboard executivo atual permanece fan-out client/API-layer e não recebeu endpoint agregado
  nesta sprint. Com 17 chamadas por iteração, o p95 local ficou em 181.06 ms. A criação de um
  endpoint agregado fica para Sprint 22 somente se staging ou UX real indicar necessidade.
- Nenhuma migration foi criada.
- Nenhum endpoint de negócio foi alterado.

## Current milestone

**Sprint — Assignment Domain + Operator Workflow**
Status: concluída em 1 de julho de 2026.

As Sprints 0, 1, 2, 3, 3.5, 4, 5, 6, 7, 8, 9, 9.5, 10, 11, 12 e 13 foram
preservadas. Esta sprint adiciona o domínio Assignment e integra o fluxo Operator sem criar agenda,
serviço ou OS paralelos.

Sprint 4 introduz o primeiro domínio operacional de produção: Customer. Organization continua
representando a empresa dona da instalação; Customer representa o cliente atendido por ela.

Sprint 5 introduziu Equipment como domínio real ligado obrigatoriamente a Customer e opcionalmente a
CustomerAddress e equipamento pai.

Sprint 6 introduziu o motor oficial de documentos de produção, exclusivamente backend:

```text
Operation
↓
DocumentBuilder
↓
DocumentBlueprint
↓
DocumentRenderer
↓
PDF Engine
```

O Builder concentra regras de negócio e resolve operação, cliente, equipamento, operador,
observações, fotos, checklist, documentos relacionados e assinatura preparada. O Blueprint é
independente de PDF. O Renderer transforma o Blueprint em páginas com cabeçalho/rodapé repetidos,
numeração, paginação e proteção contra quebras incorretas. O PDF Engine gera PDF diretamente, sem
HTML/print.

Sprint 7 adiciona a configuração documental persistida e o domínio Signature. Templates agora
suportam `requiresSignature`, `signatureMode` (`NONE`, `FIXED`, `COLLECTED`, `HYBRID`) e
`signatureId`. O Builder passa a receber organização/settings via `DocumentConfigurationService`;
ele ainda não aplica assinatura fixa/coletada no PDF, conforme fora de escopo da sprint.

Sprint 8 integra definitivamente assinaturas ao fluxo oficial:

```text
Operation
↓
DocumentContext
↓
DocumentConfigurationService
↓
DocumentBuilder
↓
DocumentBlueprint
↓
LayoutEngine
↓
DocumentRenderer
↓
PDF Engine
```

`DocumentContextService` passa a ser o ponto responsável por buscar Operation, organização,
template, configuração de assinatura e assets. O Builder não realiza consultas adicionais e apenas
transforma o contexto em Blueprint.

Sprint 9 cria o domínio oficial `AssetLifecycle`. A timeline do equipamento agora nasce de eventos
imutáveis, e não de múltiplas consultas espalhadas. Operations concluídas e documentos renderizados
registram eventos automaticamente no ciclo de vida do ativo.

Sprint 9.5 consolida a arquitetura do Asset Lifecycle antes de Maintenance Planning e PMOC:
`LifecyclePublisher` passa a ser o único ponto de publicação de eventos e `TimelineAssembler` passa
a entregar payloads prontos para renderização, com ícone, cor, título, subtítulo, categoria,
referências e anexos seguros.

Sprint 10 cria o domínio oficial **Maintenance Planning**, separando planejamento de execução. O
planejamento calcula recorrências e agenda futuras execuções; a execução operacional continua sendo
representada por `Operation`. Quando uma execução de manutenção é concluída, o histórico oficial do
ativo recebe evento `MAINTENANCE` publicado exclusivamente pelo `LifecyclePublisher`.

Sprint 11 cria o domínio oficial **PMOC Compliance** como especialização de Maintenance Planning.
PMOC não possui agenda, calendário, execução, timeline ou documento paralelos: usa
`MaintenancePlan`, `MaintenanceExecution`, `Operation`, `AssetLifecycle` e `Document Engine`.

Sprint 12 cria **Inventory & Materials**, separando Product Catalog, Inventory Item e Stock
Movement. Product continua técnico; Inventory controla apenas estoque físico; consumo em Operation
publica `PART_REPLACEMENT` via `LifecyclePublisher`.

Sprint 13 cria **Pricing** como a única fonte de informações comerciais de produtos. Product não
armazena preço e Inventory não armazena custo. Alterações comerciais criam nova vigência em
`ProductPricing`, preservando histórico.

## Architecture

- NestJS 11, TypeScript estrito, PostgreSQL e Prisma.
- API versionada em `/api/v1`.
- JWT com refresh rotation, Argon2id, guards globais e RBAC.
- Novo `UsersModule` para equipe, perfil, preferências, permissões e avatar.
- Storage local reutilizado por abstração para avatares.
- Senha temporária com troca obrigatória aplicada por guard global.
- Respostas preservam os envelopes globais de sucesso e erro.
- Demo dataset opcional em `src/seeds/demo`.
- Módulo interno local-only para leitura/reset do dataset de integração.

Módulos:

```text
src/modules/
├── auth/
├── assignments/
├── asset-lifecycle/
├── config/
├── customers/
├── document-engine/
├── database/
├── equipments/
├── health/
├── internal-demo/
├── maintenance-planning/
├── organization/
├── pmoc-compliance/
├── pricing/
├── signatures/
└── users/
```

## Persistence

Migrations:

1. `20260619090000_foundation`
2. `20260619130000_auth_rbac`
3. `20260623140000_organization_foundation`
4. `20260624110000_user_team_foundation`
5. `20260624160000_customer_domain_foundation`
6. `20260624190000_equipment_domain_foundation`
7. `20260627120000_template_is_active`
8. `20260627150000_operation_domain_foundation`
9. `20260629110000_document_engine_foundation`
10. `20260629150000_document_configuration_signature_domain`
11. `20260630110000_asset_lifecycle_foundation`
12. `20260630130000_asset_lifecycle_refinement`
13. `20260630150000_maintenance_planning_domain`
14. `20260630170000_pmoc_compliance_domain`
15. `20260701120000_inventory_materials_domain`
16. `20260701150000_pricing_domain`
17. `20260701170000_assignment_domain`

Sprint 3.5 não criou migrations e não alterou `schema.prisma`.

### Customer Domain

Entidades:

- `Customer`, com enum `PERSON`/`COMPANY`, CPF/CNPJ opcionais e soft delete;
- `CustomerAddress`;
- `CustomerContact`;
- `CustomerAttachment`, com binário no StorageProvider.

Busca parcial cobre nome, nome fantasia, telefone, e-mail, CPF e CNPJ. Listagem usa `page`, `limit`
e `search`. Endereço e contato principal são únicos por cliente por regra transacional.

RBAC:

- OWNER: acesso total;
- MANAGER: criar, editar, visualizar e gerenciar sub-recursos;
- OPERATOR/VIEWER: leitura;
- exclusão lógica do Customer e exclusão de anexos: somente OWNER.

Upload de anexos: PDF/PNG/JPG/JPEG, 5 MiB, validação de extensão, MIME e assinatura binária.

Demo:

- Hospital Santa Clara;
- Condomínio Atlântico Sul;
- Shopping Recife;
- Colégio Boa Viagem.

Os clientes demo agora usam exclusivamente as entidades reais, com endereço, contato e anexo.
`demo.customers.v1` foi removido.

Endpoints: CRUD/status/stats de customers; CRUD de addresses/contacts; upload/read/delete de
attachments.

Validação em PostgreSQL 17 confirmou migration, CRUD, busca, paginação, stats, soft delete, RBAC,
anexos, idempotência do seed e os 13 eventos de auditoria.

### Equipment Domain

Entidades:

- `Equipment`;
- `EquipmentAttachment`;
- `EquipmentMetric`;
- enums `EquipmentType`, `EquipmentStatus`, `EquipmentAttachmentCategory`.

Equipment pertence a Customer, pode apontar para CustomerAddress do mesmo cliente e pode possuir um
parent simples do mesmo cliente. Relações cruzadas e ciclo direto são rejeitados.

`qrToken` é UUID único e `qrCode` usa `equipment:<qrToken>`. Não há geração de imagem.

Busca: name, tag, serialNumber, model e manufacturer. Filtros: customerId, addressId, status e type.
Stats retornam totais por status e por tipo.

RBAC:

- OWNER total;
- MANAGER CRUD/status, anexos e métricas;
- OPERATOR leitura e criação de métricas;
- VIEWER leitura.

Demo real:

- Split Samsung 24.000 BTU;
- Condensadora LG VRF;
- Chiller Trane 120 TR;
- Inversor Fronius 8kW;
- Evaporadora LG VRF filha da condensadora.

Cada equipamento demo possui endereço real, métrica e manual PDF. `demo.equipment.v1` foi removido.

Validação: 6 migrations do zero, 5 equipamentos demo, hierarquia, filtros combinados, QR,
integridade customer/address/parent, métricas, anexos, soft delete, RBAC e nove eventos auditados.

### Document Engine

Módulo: `src/modules/document-engine`.

Camadas:

- `builder/DocumentBuilderService`: recebe `OperationDocumentContext` ou `TemplatePreviewContext` e monta um `DocumentBlueprint`;
- `blueprint/document-blueprint.types`: modelo oficial independente de PDF com Header, Footer,
  Section, Paragraph, Table, List, Image, QR Code, Checklist, SignaturePlaceholder, Observation e
  Metadata;
- `renderer/DocumentRendererService`: paginação lógica, cabeçalho/rodapé repetidos, numeração e
  quebra de tabela por blocos;
- `pdf/PdfEngineService`: geração direta de PDF 1.7 usando primitives de PDF, fontes Helvetica,
  múltiplas páginas, linhas, caixas, textos, tabelas e metadados;
- `signatures/*`: contratos e resolver padrão para futura assinatura fixa/coletada/híbrida/sem
  assinatura. Não há CRUD, tabela ou domínio funcional de assinatura nesta sprint.

`OperationDocument` recebeu:

- `storageKey`;
- `mimeType`;
- `fileSize`;
- `renderedAt`;
- `renderMetadata`.

Storage:

- PDFs são gravados em `documents/operations/<operationId>/<type>-<uuid>.pdf`;
- nomes externos nunca são usados no path;
- download retorna base64 via contrato JSON atual.

Endpoints criados:

| Method | Path                                                      | Access                           |
| ------ | --------------------------------------------------------- | -------------------------------- |
| GET    | `/api/v1/documents/operations/:operationId/:type/preview` | OWNER, MANAGER, OPERATOR, VIEWER |
| GET    | `/api/v1/documents/templates/:templateId/preview`         | OWNER, MANAGER, OPERATOR, VIEWER |
| POST   | `/api/v1/documents/operations/:operationId/:type/render`  | OWNER, MANAGER, OPERATOR         |
| GET    | `/api/v1/documents/:documentId/preview`                   | OWNER, MANAGER, OPERATOR, VIEWER |
| POST   | `/api/v1/documents/:documentId/render`                    | OWNER, MANAGER, OPERATOR         |
| GET    | `/api/v1/documents/:documentId/download`                  | OWNER, MANAGER, OPERATOR, VIEWER |

Documentos financeiros (`QUOTE`, `RECEIPT`) são bloqueados para não-OWNER por segurança.

Audit events:

- `DOCUMENT_PREVIEWED`;
- `TEMPLATE_PREVIEWED`;
- `DOCUMENT_RENDERED`;
- `DOCUMENT_DOWNLOADED`.

Limites de AppSec:

- 80 seções;
- 600 componentes;
- 400 linhas de tabela/checklist;
- 80 páginas renderizadas;
- PDF máximo de 10 MiB;
- sanitização de texto antes do Blueprint e do PDF;
- storage key gerada por UUID para evitar path traversal;
- renderer/PDF engine não acessam banco de dados.

Backlog Document Template Preview:

- `TemplatePreviewContext` criado para renderizar modelos sem `Operation`, `Customer` ou `Equipment`;
- `DocumentContextService.buildTemplatePreviewContext(templateId)` monta organização, settings, brand assets, template, assinatura e placeholders oficiais;
- `DocumentBuilderService` aceita contexto operacional ou contexto de preview de modelo e reutiliza o mesmo Blueprint/Renderer;
- endpoint `GET /api/v1/documents/templates/:templateId/preview` retorna o mesmo `DocumentBlueprint` usado pelos previews de documentos emitidos;
- não há renderização PDF definitiva nem criação de `OperationDocument` para preview de template.

### Document Configuration & Signature Domain

Sprint 7 criou a fundação de configuração documental e assinatura.

Entidades/alterações:

- `Signature`:
  - `id`;
  - `name`;
  - `title`;
  - `imageStorageKey` interno, nunca exposto no contrato público;
  - `mimeType`;
  - `originalFileName`;
  - `fileSize`;
  - `active`;
  - `deletedAt`;
  - `createdAt`;
  - `updatedAt`.
- `DocumentTemplate`:
  - `requiresSignature Boolean @default(false)`;
  - `signatureMode SignatureMode @default(NONE)`;
  - `signatureId String?`.
- enum `SignatureMode`: `NONE`, `FIXED`, `COLLECTED`, `HYBRID`.

Arquitetura criada:

- `DocumentAssetResolver`: única porta para assets de documentos no StorageProvider. Centraliza PDF,
  assinaturas e futuros logos/marca d'água/fotos/QR codes;
- `DocumentConfigurationService`: fornece organização, settings, templates ativos, default template
  e assinatura para o Builder sem expor consultas diretas a tabelas;
- `LayoutEngine`: prepara cálculo de área imprimível, largura útil, altura útil e quebra lógica de
  página;
- `DocumentMeasureService`: mede texto, tabela, imagem, lista e checklist para uso do LayoutEngine;
- `SignaturesModule`: CRUD, upload/download e auditoria de assinaturas.

Endpoints criados:

| Method | Path                                            | Access                 |
| ------ | ----------------------------------------------- | ---------------------- |
| GET    | `/api/v1/documents/configuration`               | OWNER, MANAGER, VIEWER |
| GET    | `/api/v1/documents/configuration/types/:type`   | OWNER, MANAGER, VIEWER |
| GET    | `/api/v1/documents/configuration/templates/:id` | OWNER, MANAGER, VIEWER |
| GET    | `/api/v1/signatures`                            | OWNER, MANAGER, VIEWER |
| GET    | `/api/v1/signatures/:id`                        | OWNER, MANAGER, VIEWER |
| POST   | `/api/v1/signatures`                            | OWNER                  |
| PATCH  | `/api/v1/signatures/:id`                        | OWNER                  |
| DELETE | `/api/v1/signatures/:id`                        | OWNER                  |
| POST   | `/api/v1/signatures/:id/upload`                 | OWNER                  |
| GET    | `/api/v1/signatures/:id/download`               | OWNER, MANAGER, VIEWER |

AppSec:

- OPERATOR sem acesso ao domínio de configuração/assinatura;
- OWNER é o único papel com escrita;
- upload de assinatura limitado a 2 MiB;
- PNG/JPG/JPEG com validação de extensão, MIME e assinatura binária;
- nome original sanitizado e nunca usado para storage key;
- storage key gerada com UUID;
- soft delete de assinatura (`active=false`);
- templates `FIXED`/`HYBRID` exigem assinatura ativa;
- AuditLog registra criação/edição/soft delete/upload/download de assinatura.

Audit events:

- `SIGNATURE_CREATED`;
- `SIGNATURE_UPDATED`;
- `SIGNATURE_DELETED`;
- `SIGNATURE_IMAGE_UPLOADED`;
- `SIGNATURE_IMAGE_DOWNLOADED`.

Seeds:

- Demo seed cria assinaturas de exemplo somente quando `ENABLE_DEMO_DATA=true`;
- reset demo remove assinaturas e imagens demo pelo manifesto;
- nenhuma nova migration ou dependência foi criada para demo dataset.

Validação executada:

- `npm run lint`;
- `npm test`;
- `npm run build`;
- `DATABASE_URL=... npx prisma validate`;
- todas as migrations foram aplicadas em PostgreSQL 17 limpo, incluindo
  `20260629150000_document_configuration_signature_domain`.

### Document Signature Integration

Sprint 8 não criou migrations nem alterou endpoints. A integração é arquitetural e funcional dentro
do Document Engine.

Novos/alterados:

- `DocumentContextService`: entrega ao Builder um único objeto contendo Operation, cliente,
  equipamento, operador, organização, settings, template, configuração de assinatura e assets
  resolvidos;
- `DocumentBlueprint` recebeu componente `signature`;
- `DocumentRendererService` renderiza assinatura fixa, linha manual, nome, cargo, data e legenda;
- `PdfEngineService` recebeu suporte a imagem de assinatura:
  - JPEG via `/DCTDecode`;
  - PNG 8-bit gray/RGB/gray+alpha/RGBA com filtros PNG básicos e `/FlateDecode`;
- `DocumentAssetResolver` resolve assinatura, logo, marca d'água, QR Code e imagens documentais;
- seed demo de assinatura passou a usar PNG válido para renderização direta no PDF.

Modos:

- `NONE`: não adiciona seção de assinatura;
- `FIXED`: carrega assinatura ativa configurada no template, resolve imagem via
  `DocumentAssetResolver` e insere no Blueprint/PDF;
- `COLLECTED`: reserva área manual, sem inserir assinatura fixa;
- `HYBRID`: insere assinatura fixa e reserva também área manual.

Paginação:

- componente `signature` sempre usa `keepTogether=true`;
- Renderer move o bloco inteiro para a próxima página se não houver espaço;
- tabelas continuam quebradas por blocos com cabeçalho repetido;
- checklists continuam renderizados como blocos não quebrados por item.

AppSec:

- assinatura inexistente/inativa/imagem ausente interrompe render com erro controlado;
- nenhuma camada acessa storage diretamente fora do `DocumentAssetResolver`;
- imagem de assinatura não entra no AuditLog;
- PDF mantém limite de 10 MiB;
- textos são sanitizados antes do Blueprint/PDF;
- PNG/JPEG inválido é rejeitado pelo PDF engine.

Validação executada:

- `npm run lint`;
- `npm test`;
- `npm run build`;
- `DATABASE_URL=... npx prisma validate`.

### Stage 0

`Organization` recebeu:

- `segment String?`

`DocumentTemplate` recebeu:

- `isSystem Boolean @default(false)`

Templates default existentes são migrados para `isSystem=true`. Templates de sistema podem ser
editados, mas não excluídos.

### User expandido

Campos adicionados:

- `avatarAssetId`
- `phone`
- `jobTitle`
- `notes`
- `mustChangePassword`
- `disabledAt`

### Novas entidades

`UserPreferences`:

- `id`
- `userId` único
- `theme`: `SYSTEM`, `LIGHT` ou `DARK`
- `notificationsEnabled`
- timestamps

`UserPermission`:

- `id`
- `userId` único
- `canFinancial`
- `canUsers`
- `canReports`
- `canSchedules`
- `canTemplates`
- timestamps

`UserAvatarAsset`:

- metadados do arquivo de avatar;
- relação opcional um-para-um com `User`;
- storage key independente dos assets organizacionais.

Não foi criado campo de idioma, locale ou infraestrutura i18n para usuários.

## Access model

- `OWNER`: lista, consulta, cria, edita, desativa, ativa, remove por soft delete e redefine senha.
- `MANAGER`: lista e consulta equipe.
- `VIEWER`: lista e consulta equipe em modo leitura.
- `OPERATOR`: somente perfil, preferências, senha e avatar próprios.
- Todos os papéis podem gerenciar suas próprias preferências, senha e avatar.

Permissões granulares complementam o papel:

- OWNER recebe todas efetivamente como `true`;
- MANAGER possui valores configuráveis pelo OWNER;
- OPERATOR e VIEWER permanecem com os cinco flags administrativos em `false`.

## Password lifecycle

- Criação e reset geram senha aleatória de 32 caracteres base64url.
- A senha temporária é retornada uma única vez na resposta.
- `mustChangePassword=true` é obrigatório em criação/reset.
- Guard global bloqueia rotas normais com `PASSWORD_CHANGE_REQUIRED`.
- Permanecem acessíveis durante bootstrap: login, `/auth/me`, `/users/me` e troca de senha.
- Troca e reset revogam todas as sessões ativas.
- Troca rejeita senha atual inválida e reutilização da senha corrente.

## Soft delete and owner safety

- `DELETE /users/:id` não remove registro.
- Soft delete define `isActive=false` e `disabledAt`.
- Disable/delete revogam sessões imediatamente.
- OWNER não pode desativar ou excluir a própria conta.
- O último OWNER ativo não pode ser desativado, removido ou rebaixado.

## Avatar security

- Extensões: `png`, `jpg`, `jpeg`.
- MIME: `image/png`, `image/jpeg`.
- Limite: 2 MiB.
- Assinatura binária PNG/JPEG é validada.
- Nome de storage usa UUID em `users/avatar/`.
- Nome original é apenas metadado sanitizado.
- Substituição remove o asset anterior.

## Endpoints added

| Method | Path                               | Access                      |
| ------ | ---------------------------------- | --------------------------- |
| GET    | `/api/v1/users`                    | OWNER, MANAGER, VIEWER      |
| GET    | `/api/v1/users/:id`                | OWNER, MANAGER, VIEWER      |
| POST   | `/api/v1/users`                    | OWNER                       |
| PATCH  | `/api/v1/users/:id`                | OWNER                       |
| DELETE | `/api/v1/users/:id`                | OWNER                       |
| PATCH  | `/api/v1/users/:id/disable`        | OWNER                       |
| PATCH  | `/api/v1/users/:id/enable`         | OWNER                       |
| PATCH  | `/api/v1/users/:id/reset-password` | OWNER                       |
| PATCH  | `/api/v1/users/change-password`    | Todos, para a própria conta |
| GET    | `/api/v1/users/me/preferences`     | Todos, para a própria conta |
| PATCH  | `/api/v1/users/me/preferences`     | Todos, para a própria conta |
| GET    | `/api/v1/users/me`                 | Todos, para a própria conta |
| POST   | `/api/v1/users/avatar`             | Todos, para a própria conta |
| GET    | `/api/v1/users/avatar/:id`         | Todos os autenticados       |
| DELETE | `/api/v1/users/avatar`             | Todos, para a própria conta |

`GET /users` aceita `page`, `limit` e `search`.

## Audit events

- `USER_CREATED`
- `USER_UPDATED`
- `USER_DISABLED`
- `USER_ENABLED`
- `USER_DELETED`
- `PASSWORD_RESET`
- `PASSWORD_CHANGED`
- `AVATAR_UPDATED`
- `PREFERENCES_UPDATED`

Senhas, hashes, tokens e conteúdo base64 não são registrados.

## Seed

O seed continua idempotente e agora:

- cria preferências e permissões completas para o OWNER;
- corrige esses registros quando o OWNER já existe;
- marca os seis templates padrão como `isSystem=true`.

## Verification performed

- Prisma schema válido e client gerado.
- Quatro migrations executadas do zero em PostgreSQL 17.
- Build Docker aprovado.
- Health check com banco conectado.
- Build TypeScript aprovado.
- ESLint aprovado.
- 2 suítes e 6 testes aprovados.
- Fluxos reais validados em container:
  - login OWNER;
  - profile agregado;
  - segment organizacional;
  - proteção de template de sistema;
  - criação de MANAGER;
  - bloqueio por troca obrigatória;
  - troca de senha e revogação da sessão anterior;
  - paginação/busca;
  - leitura MANAGER e escrita negada;
  - preferências;
  - upload/leitura/exclusão de avatar;
  - disable/enable;
  - reset de senha;
  - soft delete;
  - proteção contra auto-desativação.

## Explicitly not implemented

- convites ou recuperação por e-mail;
- MFA, SSO ou notificações reais;
- idioma/locale/i18n de usuário;
- clientes, equipamentos, produtos, serviços, agenda, orçamentos, OS, relatórios operacionais ou
  financeiro.

## Future work

- Sprint 4 pode iniciar o primeiro módulo operacional.
- Aplicar os flags granulares em módulos futuros por decorators/guards específicos do recurso.
- Considerar streaming/binário de avatar quando cache HTTP for necessário.
- Adicionar política automática para limpeza de sessões expiradas e arquivos órfãos.

## Sprint 3.5 demo environment

Variáveis:

- `ENABLE_DEMO_DATA=false` por padrão;
- `ENABLE_DEMO_ENDPOINTS=false` por padrão.

Produção rejeita startup se qualquer flag estiver habilitada.

Seed:

- `src/seeds/demo/demo.seed.ts`;
- executável por `npm run prisma:seed:demo`;
- também invocado pelo seed principal quando habilitado;
- idempotente;
- gera senhas aleatórias somente para usuários efetivamente criados;
- não sobrescreve usuários ou organizações personalizadas.

Dados reais nas entidades existentes:

- organização Climatize Refrigeração em instalação vazia/bootstrap;
- usuários `ninja`, `ricardo`, `joao`, `maria`, `financeiro`;
- preferências e permissões para contas criadas.

Snapshots temporários em `SystemSetting`:

- dashboard;
- agenda;
- financeiro;
- manifesto interno.

Esses snapshots não representam modelagem final dos módulos.

Endpoints internos:

| Method | Path                            | Access |
| ------ | ------------------------------- | ------ |
| GET    | `/api/v1/internal/demo/dataset` | OWNER  |
| POST   | `/api/v1/internal/demo/reset`   | OWNER  |

Ambos exigem ambiente development e os dois flags demo. Quando desabilitados respondem 404.

Documentação adicionada:

- `docs/backend/DEMO_DATA.md`;
- `docs/backend/OPUS_INTEGRATION.md`.

Verificações específicas:

- ambiente sem demo mantém flags false;
- execução sem demo criou zero chaves `demo.*`;
- desenvolvimento aceita demo;
- produção rejeita demo;
- snapshots são determinísticos para uma data fixa;
- nomes realistas e equipamentos esperados validados em testes.
- seed executado duas vezes sem duplicar usuários ou reemitir senhas;
- reset interno recriou apenas registros demo;
- resultado validado: 5 usuários, 5 preferências e 6 settings reservados;
- dataset interno retornou 4 clientes e 4 equipamentos;
- endpoint interno retornou 404 quando flags estavam desligadas.

## Backlog #001 — Agenda (produção)

- `demo.schedule.v1` enriquecido (equipment, serviceType, endsAt, notes, estado `DONE`) e distribuído por meses adjacentes para a navegação do calendário; sem novos snapshots.
- Contrato futuro `GET /schedule?from=&to=&month=&year=` documentado (API_CONTRACTS) — o frontend já consulta por intervalo a cada navegação.

## Backlog #002 — QR Code operacional

- Novo endpoint `GET /equipments/lookup/:qrCode` (service `lookupByQrCode`) — aceita `qrCode`/`qrToken`, retorna o equipamento completo, 404 quando inexistente, 400 para QR vazio. Formato do QR inalterado.
- Documentado em API_CONTRACTS / FRONTEND_INTEGRATION / OPUS_INTEGRATION.

## Backlog #003 — Relatórios, Documentos e Templates

- `DocumentTemplate.isActive` (migration `20260627120000_template_is_active`) — ativar/desativar modelos; DTO/serviço/contratos atualizados. Sem novos Demo Datasets (usa `demo.documents.v1`).

## Backlog #004 — Operações (OS + Formulários Base)

- Novo domínio **Operation** (real, Prisma): `Operation`, `OperationPhoto`, `OperationDocument` + enums `OperationType`/`OperationStatus`/`OperationDocumentStatus`. Migration `20260627150000_operation_domain_foundation`.
- Módulo `operations` (controller/service/dto): `GET /operations` (filtros), `/stats`, `/:id`, `/photos/:id` (base64), `POST /operations` (cria + **OS rascunho** automática `WORK_ORDER/DRAFT`, número `OS-000001` derivado do sequencial), `PATCH /:id`. Operador = usuário autenticado por padrão; `OWNER`/`MANAGER` podem delegar via `operatorId`; fotos via storage provider (data URL, PNG/JPEG, 16 × 5 MiB); assinatura como texto.
- Toda OS nasce de uma Operation; `OperationDocument` reusa `DocumentTemplateType` (fundação única para OS/PMOC/Laudo/Relatório/Visita/Orçamento/Recibo). Histórico de equipamento/cliente derivado de `/operations` (sem duplicação). PDF oficial é gerado pelo Document Engine da Sprint 6.
- Validado com `prisma generate` + `tsc --noEmit` (sem banco neste ambiente; migration roda no deploy).

## Sprint 9 — Asset Lifecycle Foundation

Domínio criado:

- `src/modules/asset-lifecycle`;
- `AssetLifecycleService` como único ponto de criação e leitura de eventos históricos;
- `AssetLifecycleController` expondo timeline, eventos, anexos e estatísticas;
- `AssetLifecycleModule` exportado para integrações internas.

Entidades:

- `AssetLifecycleEvent`;
- `AssetLifecycleAttachment`.

Enum oficial:

- `INSTALLATION`;
- `INSPECTION`;
- `PREVENTIVE`;
- `CORRECTIVE`;
- `MAINTENANCE`;
- `PART_REPLACEMENT`;
- `WARRANTY`;
- `DOCUMENT`;
- `NOTE`;
- `CUSTOM`.

Decisões arquiteturais:

- eventos históricos são imutáveis: não há endpoint de edição ou exclusão de evento;
- correções devem ser representadas por novo evento;
- anexos possuem soft delete em `deletedAt`;
- PDFs e imagens não são duplicados no evento: documentos gerados são referenciados por `documentId`;
- Operations concluídas geram evento automaticamente via `recordOperationCompletedTx`;
- Document Engine registra evento `DOCUMENT` automaticamente após renderização via `recordDocumentRenderedTx`;
- integrações automáticas são idempotentes por `operationId`/`documentId`.

Timeline:

- construída exclusivamente a partir de `AssetLifecycleEvent`;
- suporta paginação;
- suporta filtros por equipamento, operação, tipo, operador e período;
- ordenação padrão por `occurredAt desc`.

Endpoints adicionados:

| Method | Path                                                    | Access                           |
| ------ | ------------------------------------------------------- | -------------------------------- |
| GET    | `/api/v1/asset-lifecycle`                               | OWNER, MANAGER, OPERATOR, VIEWER |
| GET    | `/api/v1/asset-lifecycle/:id`                           | OWNER, MANAGER, OPERATOR, VIEWER |
| POST   | `/api/v1/asset-lifecycle`                               | OWNER, MANAGER, OPERATOR         |
| GET    | `/api/v1/equipments/:id/lifecycle`                      | OWNER, MANAGER, OPERATOR, VIEWER |
| GET    | `/api/v1/equipments/:id/lifecycle/stats`                | OWNER, MANAGER, OPERATOR, VIEWER |
| GET    | `/api/v1/asset-lifecycle/:id/attachments`               | OWNER, MANAGER, OPERATOR, VIEWER |
| POST   | `/api/v1/asset-lifecycle/:id/attachments`               | OWNER, MANAGER, OPERATOR         |
| DELETE | `/api/v1/asset-lifecycle/:id/attachments/:attachmentId` | OWNER, MANAGER                   |

Auditoria:

- `ASSET_LIFECYCLE_EVENT_CREATED`;
- `ASSET_LIFECYCLE_EVENT_AUTO_CREATED`;
- `ASSET_LIFECYCLE_ATTACHMENT_UPLOADED`;
- `ASSET_LIFECYCLE_ATTACHMENT_DELETED`.

Seed demo:

- `src/seeds/demo/demo.seed.ts` agora cria histórico coerente para equipamentos demo existentes;
- eventos são idempotentes e marcados com `DEMO_MARKER`;
- nenhum novo Demo Dataset foi criado.

Verificação executada:

- `npx prisma generate`;
- `DATABASE_URL=postgresql://user:pass@localhost:5432/db npx prisma validate`;
- todas as migrations aplicadas em PostgreSQL Docker limpo, incluindo `20260630110000_asset_lifecycle_foundation`;
- `npm run build`;
- `npm run lint`;
- `npm test` com 7 suítes e 21 testes aprovados.

## Sprint 11 — PMOC Compliance Domain

Domínio criado:

- `src/modules/pmoc-compliance`;
- `PmocComplianceService` como façade de PMOC, ambientes, compliance status, estatísticas e
  preparação documental;
- `ComplianceEvaluator` e tipos base para futura Compliance Engine;
- `PmocComplianceController` expondo API PMOC;
- `PmocComplianceModule` importado no `AppModule`.

Entidades:

- `PmocPlan`;
- `PmocEnvironment`;
- `PmocPlanEquipment`;
- `PmocEnvironmentEquipment`.

Enum oficial:

- `PmocComplianceStatus`: `COMPLIANT`, `WARNING`, `OVERDUE`, `NON_COMPLIANT`, `IN_PROGRESS`.

Asset Lifecycle expandido:

- `PMOC_CREATED`;
- `PMOC_UPDATED`;
- `PMOC_COMPLETED`;
- `PMOC_EXPIRED`.

Decisões arquiteturais:

- cada PMOC possui exatamente um `MaintenancePlan`;
- PMOC não armazena recorrência própria;
- PMOC não cria execução própria;
- ambientes relacionam equipamentos reais, sem duplicar `Equipment`;
- execuções continuam em `MaintenanceExecution`;
- intervenções continuam em `Operation`;
- timeline continua em `AssetLifecycle`;
- documentos PMOC são preparados para `DocumentTemplateType.PMOC` via Document Engine.

Compliance status:

- `NON_COMPLIANT`: PMOC ou MaintenancePlan inativo;
- `OVERDUE`: validade vencida ou execução planejada vencida;
- `IN_PROGRESS`: vigência futura;
- `WARNING`: execução prevista nos próximos sete dias;
- `COMPLIANT`: ativo, vigente e sem pendências próximas/vencidas.

Endpoints adicionados:

| Method | Path                            | Access                           |
| ------ | ------------------------------- | -------------------------------- |
| GET    | `/api/v1/pmoc/stats`            | OWNER, MANAGER, OPERATOR, VIEWER |
| GET    | `/api/v1/pmoc`                  | OWNER, MANAGER, OPERATOR, VIEWER |
| GET    | `/api/v1/pmoc/:id`              | OWNER, MANAGER, OPERATOR, VIEWER |
| POST   | `/api/v1/pmoc`                  | OWNER, MANAGER                   |
| PATCH  | `/api/v1/pmoc/:id`              | OWNER, MANAGER                   |
| DELETE | `/api/v1/pmoc/:id`              | OWNER, MANAGER                   |
| GET    | `/api/v1/pmoc/:id/environments` | OWNER, MANAGER, OPERATOR, VIEWER |
| POST   | `/api/v1/pmoc/:id/environments` | OWNER, MANAGER                   |
| PATCH  | `/api/v1/pmoc/environments/:id` | OWNER, MANAGER                   |
| DELETE | `/api/v1/pmoc/environments/:id` | OWNER, MANAGER                   |
| GET    | `/api/v1/pmoc/:id/compliance`   | OWNER, MANAGER, OPERATOR, VIEWER |
| GET    | `/api/v1/equipments/:id/pmoc`   | OWNER, MANAGER, OPERATOR, VIEWER |

Auditoria:

- `PMOC_CREATED`;
- `PMOC_UPDATED`;
- `PMOC_DELETED`;
- `PMOC_ENVIRONMENT_CREATED`;
- `PMOC_ENVIRONMENT_UPDATED`;
- `PMOC_ENVIRONMENT_DELETED`.

Integrações:

- PMOC cria `MaintenancePlan` preventivo e primeira `MaintenanceExecution`;
- conclusão de execução PMOC publica `MAINTENANCE` e `PMOC_COMPLETED` via `LifecyclePublisher`;
- criação/atualização/vencimento publica eventos PMOC via `LifecyclePublisher`;
- compliance retorna configuração documental `PMOC` via `DocumentConfigurationService`.

Seed demo:

- `src/seeds/demo/demo.seed.ts` cria PMOCs coerentes para Chiller Hospital Santa Clara e VRF
  Shopping Recife;
- dados são idempotentes, opcionais e removíveis pelo manifesto demo;
- nenhum novo Demo Dataset foi criado.

Verificação executada até este registro:

- `npx prisma generate`;
- `DATABASE_URL=postgresql://user:pass@localhost:5432/db npx prisma validate`;
- todas as migrations aplicadas em PostgreSQL Docker limpo, incluindo
  `20260630170000_pmoc_compliance_domain`;
- `npm run build`;
- `npm run lint`;
- `npm test` com 7 suítes e 21 testes aprovados.

## Sprint 9.5 — Asset Lifecycle Refinement & Consolidation

Arquitetura consolidada:

- `LifecyclePublisher`: serviço oficial para publicação de eventos do ciclo de vida;
- `TimelineAssembler`: serviço oficial para montar timeline pronta para consumo;
- `AssetLifecycleService`: permanece como façade de API, listagem, anexos, estatísticas e
  enriquecimento de payload;
- Operations e Document Engine não dependem mais do `AssetLifecycleService` para emitir eventos.

Garantia arquitetural:

- criação direta de `AssetLifecycleEvent` no backend ficou concentrada em
  `LifecyclePublisher`;
- integrações atuais migradas:
  - `OperationsService` usa `publishOperationCompletedTx`;
  - `DocumentEngineService` usa `publishDocumentRenderedTx`;
  - seed demo usa `publishManual` para enriquecer dados existentes.

Timeline enriquecida:

- cada evento retorna também `timeline`;
- listagens retornam `timelineGroups`;
- `timeline` inclui:
  - `icon`;
  - `color`;
  - `title`;
  - `subtitle`;
  - `category`;
  - `description`;
  - `date`;
  - `groupKey`;
  - `sortKey`;
  - `user`;
  - `type`;
  - `operationId`;
  - `documentId`;
  - `equipmentId`;
  - `references`;
  - `attachments`;
  - `badges`.

Contratos preservados:

- os campos originais de `AssetLifecycleEvent` continuam no payload;
- os novos campos são aditivos;
- nenhum endpoint novo foi criado.

Melhorias de API:

- `GET /asset-lifecycle` passa a aceitar filtro `customerId`;
- ordenação passou a usar `occurredAt desc` e `id desc` para consistência;
- eventos `DOCUMENT` incluem metadata com `documentId`, `documentType`, `documentNumber`,
  `renderStatus` e `renderedAt`;
- eventos de Operation incluem metadata com `operationId`, `operationNumber`, `operationType` e
  `operationStatus`.

Performance:

- migration `20260630130000_asset_lifecycle_refinement` adiciona índices:
  - `asset_lifecycle_eq_type_at_idx`;
  - `asset_lifecycle_eq_performer_at_idx`;
  - `asset_lifecycle_at_id_idx`;
  - `asset_lifecycle_doc_type_idx`;
- migration foundation usa índice curto explícito `asset_lifecycle_eq_at_idx`;
- esses índices cobrem timeline por equipamento, filtros por tipo, operador, período e documentos.

Verificação executada:

- `DATABASE_URL=postgresql://user:pass@localhost:5432/db npx prisma validate`;
- todas as migrations aplicadas em PostgreSQL Docker limpo;
- `npm run build`;
- `npm run lint`;
- `npm test` com 7 suítes e 21 testes aprovados.

## Sprint 10 — Maintenance Planning Domain

Domínio criado:

- `src/modules/maintenance-planning`;
- `MaintenancePlanningService` como façade transacional de planos, execuções, estatísticas e
  sincronização com Operations;
- `RecurringEngine` independente para cálculo de próximas ocorrências;
- `MaintenancePlanningController` expondo a API de planejamento e consultas por equipamento;
- `MaintenancePlanningModule` importado no `AppModule` e no `OperationsModule`.

Entidades:

- `MaintenancePlan`;
- `MaintenanceExecution`.

Enums:

- `MaintenancePlanType`: `PREVENTIVE`, `INSPECTION`, `WARRANTY`, `CUSTOM`;
- `MaintenancePriority`: `LOW`, `MEDIUM`, `HIGH`, `CRITICAL`;
- `MaintenanceExecutionStatus`: `PLANNED`, `LINKED`, `COMPLETED`, `CANCELED`.

Recorrência:

- `DAILY`;
- `WEEKLY`;
- `MONTHLY`;
- `YEARLY`;
- `INTERVAL_DAYS`;
- `INTERVAL_MONTHS`.

Decisões arquiteturais:

- planejamento e execução permanecem separados;
- `MaintenancePlan` calcula agenda futura e guarda `firstExecution`, `nextExecution` e
  `lastExecution`;
- `MaintenanceExecution` representa a ocorrência planejada e pode ser vinculada a uma `Operation`;
- o `RecurringEngine` recebe apenas regras de recorrência e datas, sem conhecer PMOC, garantia, SLA
  ou qualquer domínio específico;
- não há cron nem geração automática de Operations nesta sprint;
- conclusão de execução publica evento `MAINTENANCE` via `LifecyclePublisher`;
- nenhum módulo cria evento histórico diretamente;
- vincular uma Operation concluída a uma execução atualiza `status`, `executedAt`, `lastExecution` e
  `nextExecution`;
- `OperationsService` sincroniza execuções vinculadas quando uma Operation é concluída.

Endpoints adicionados:

| Method | Path                                          | Access                           |
| ------ | --------------------------------------------- | -------------------------------- |
| GET    | `/api/v1/maintenance-plans/stats`             | OWNER, MANAGER, OPERATOR, VIEWER |
| GET    | `/api/v1/maintenance-plans`                   | OWNER, MANAGER, OPERATOR, VIEWER |
| GET    | `/api/v1/maintenance-plans/:id`               | OWNER, MANAGER, OPERATOR, VIEWER |
| POST   | `/api/v1/maintenance-plans`                   | OWNER, MANAGER                   |
| PATCH  | `/api/v1/maintenance-plans/:id`               | OWNER, MANAGER                   |
| DELETE | `/api/v1/maintenance-plans/:id`               | OWNER, MANAGER                   |
| GET    | `/api/v1/maintenance-plans/:id/executions`    | OWNER, MANAGER, OPERATOR, VIEWER |
| POST   | `/api/v1/maintenance-plans/:id/executions`    | OWNER, MANAGER, OPERATOR         |
| PATCH  | `/api/v1/maintenance-executions/:id`          | OWNER, MANAGER, OPERATOR         |
| GET    | `/api/v1/equipments/:id/maintenance`          | OWNER, MANAGER, OPERATOR, VIEWER |
| GET    | `/api/v1/equipments/:id/maintenance/upcoming` | OWNER, MANAGER, OPERATOR, VIEWER |

Auditoria:

- `MAINTENANCE_PLAN_CREATED`;
- `MAINTENANCE_PLAN_UPDATED`;
- `MAINTENANCE_PLAN_DELETED`;
- `MAINTENANCE_EXECUTION_CREATED`;
- `MAINTENANCE_EXECUTION_UPDATED`;
- `MAINTENANCE_EXECUTION_COMPLETED`.

Integração com Asset Lifecycle:

- execuções concluídas geram evento `MAINTENANCE`;
- o evento referencia `maintenancePlanId`, `maintenanceExecutionId`, `operationId` quando houver,
  nome do plano e notas;
- publicação passa por `LifecyclePublisher.publishMaintenanceCompletedTx`.

Seed demo:

- `src/seeds/demo/demo.seed.ts` foi enriquecido com planos coerentes para equipamentos existentes;
- os planos são opcionais, idempotentes e marcados com `DEMO_MARKER`;
- nenhum novo Demo Dataset foi criado;
- o sistema continua funcionando sem `ENABLE_DEMO_DATA`.

Verificação executada até este registro:

- `npx prisma generate`;
- `DATABASE_URL=postgresql://user:pass@localhost:5432/db npx prisma validate`;
- todas as migrations aplicadas em PostgreSQL Docker limpo, incluindo
  `20260630150000_maintenance_planning_domain`;
- `npm run build`.
- `npm run lint`;
- `npm test` com 7 suítes e 21 testes aprovados.

## Sprint 12 — Inventory & Materials Domain

Domínio criado:

- `src/modules/inventory`;
- `InventoryModule` importado no `AppModule`;
- `InventoryService` como façade transacional para catálogo de produtos, estoque físico,
  movimentações, fornecedores e materiais consumidos em Operations;
- controllers separados para Product Catalog, Inventory, Suppliers e Operation Materials;
- constantes de auditoria em `src/shared/constants/inventory.constants.ts`.

Entidades:

- `Product`: catálogo do produto. Não armazena saldo nem movimentações;
- `Supplier`: cadastro de fornecedores para compras futuras;
- `ProductSupplier`: vínculo catálogo↔fornecedor. V1 usa fornecedor principal; a junction preserva
  evolução futura para múltiplos fornecedores por produto sem alterar `Product`;
- `InventoryItem`: estoque físico associado a um `Product`, preparado para múltiplos almoxarifados;
- `StockMovement`: evento imutável de estoque;
- `OperationPart`: material/produto consumido por uma `Operation`.

Enum:

- `StockMovementType`: `IN`, `OUT`, `ADJUSTMENT`, `TRANSFER`, `CONSUMPTION`, `RETURN`.

Migration criada:

- `20260701120000_inventory_materials_domain`.
- `20260710130000_product_supplier_relationship` adiciona `product_suppliers`.

Decisões arquiteturais:

- Product Catalog e Inventory Item foram separados: produto descreve catálogo; item de inventário
  representa saldo físico;
- toda alteração de estoque cria `StockMovement`; não existe endpoint para editar movimentações;
- `currentQuantity` e `availableQuantity` são recalculados no backend a partir das movimentações;
- `availableQuantity = currentQuantity - reservedQuantity`;
- saldo negativo é rejeitado transacionalmente;
- consumo de materiais em Operation cria `OperationPart`, `StockMovement(CONSUMPTION)`, atualiza
  estoque e publica `PART_REPLACEMENT` via `LifecyclePublisher`;
- remoção de material de Operation é soft delete no `OperationPart` e gera `StockMovement(RETURN)`;
- histórico de estoque e histórico do ativo permanecem separados, ligados por referências.
- Product↔Supplier agora é persistido por junction (`ProductSupplier`), não por campo direto em
  `Product`, para manter Procurement independente e permitir expansão futura.

Product Backlog Closure 01.1:

- `CreateProductDto` e `UpdateProductDto` aceitam `primarySupplierId?: uuid | null`;
- `InventoryService` valida fornecedor existente/ativo e sincroniza a relação principal em
  `product_suppliers`;
- respostas de `GET/POST/PATCH /products` incluem `suppliers[]` com a entidade `supplier`;
- `primarySupplierId: null` remove o vínculo do produto;
- a associação é auditada junto com `PRODUCT_CREATED`/`PRODUCT_UPDATED`.

Endpoints adicionados:

| Method | Path                                   | Access                           |
| ------ | -------------------------------------- | -------------------------------- |
| GET    | `/api/v1/products`                     | OWNER, MANAGER, OPERATOR, VIEWER |
| GET    | `/api/v1/products/:id`                 | OWNER, MANAGER, OPERATOR, VIEWER |
| POST   | `/api/v1/products`                     | OWNER, MANAGER                   |
| PATCH  | `/api/v1/products/:id`                 | OWNER, MANAGER                   |
| DELETE | `/api/v1/products/:id`                 | OWNER, MANAGER                   |
| GET    | `/api/v1/inventory`                    | OWNER, MANAGER, OPERATOR, VIEWER |
| GET    | `/api/v1/inventory/:id`                | OWNER, MANAGER, OPERATOR, VIEWER |
| PATCH  | `/api/v1/inventory/:id`                | OWNER, MANAGER                   |
| GET    | `/api/v1/inventory/stats`              | OWNER, MANAGER, OPERATOR, VIEWER |
| POST   | `/api/v1/inventory/movements`          | OWNER, MANAGER, OPERATOR         |
| GET    | `/api/v1/inventory/movements`          | OWNER, MANAGER, OPERATOR, VIEWER |
| GET    | `/api/v1/suppliers`                    | OWNER, MANAGER                   |
| POST   | `/api/v1/suppliers`                    | OWNER, MANAGER                   |
| PATCH  | `/api/v1/suppliers/:id`                | OWNER, MANAGER                   |
| DELETE | `/api/v1/suppliers/:id`                | OWNER, MANAGER                   |
| GET    | `/api/v1/operations/:id/materials`     | OWNER, MANAGER, OPERATOR, VIEWER |
| POST   | `/api/v1/operations/:id/materials`     | OWNER, MANAGER, OPERATOR         |
| DELETE | `/api/v1/operations/:id/materials/:id` | OWNER, MANAGER                   |

Auditoria:

- `PRODUCT_CREATED`;
- `PRODUCT_UPDATED`;
- `PRODUCT_DELETED`;
- `SUPPLIER_CREATED`;
- `SUPPLIER_UPDATED`;
- `SUPPLIER_DELETED`;
- `INVENTORY_ITEM_CREATED`;
- `INVENTORY_ITEM_UPDATED`;
- `STOCK_MOVEMENT_CREATED`;
- `MATERIAL_CONSUMED`;
- `MATERIAL_RETURNED`.

Integração com Asset Lifecycle:

- `LifecyclePublisher.publishPartReplacementTx` publica `PART_REPLACEMENT`;
- o evento referencia `operationId`, `operationPartId`, `productId`, `inventoryItemId`, quantidade
  e nome do produto;
- nenhum serviço de inventário cria `AssetLifecycleEvent` diretamente fora do publisher.

Seed:

- seed idempotente adiciona fornecedor, produtos HVAC, itens de estoque, entrada inicial e consumo
  coerente quando existem Operations;
- não cria novo Demo Dataset;
- o sistema funciona sem dados de demonstração.

Verificação executada:

- `DATABASE_URL=postgresql://user:pass@localhost:5432/db npx prisma validate`;
- `DATABASE_URL=postgresql://user:pass@localhost:5432/db npx prisma generate`;
- `npm run build`;
- `npm run lint`.
- `npm test`.

## Sprint 20 — AppSec & Security Verification

Campanha AppSec inicial executada sobre a aplicação NestJS real via HTTP/Supertest, com guards
globais, `ValidationPipe`, RBAC, exception filter, rate limit e PostgreSQL real.

Infraestrutura criada:

- `backend/test/jest-security.json`;
- `backend/test/security/security-app.ts`;
- `backend/test/security/auth.security.spec.ts`;
- `backend/test/security/rbac-commercial.security.spec.ts`;
- `backend/test/security/financial-mass-assignment.security.spec.ts`;
- `backend/test/security/upload-storage.security.spec.ts`;
- `backend/test/security/assignment-workflow.security.spec.ts`;
- `backend/test/security/query-error-leakage.security.spec.ts`;
- script `npm run test:security`.

Findings corrigidos:

- `S1-FIN-001`: criação de `FinancialEntry` aceitava `status=PAID` e `paidAt`, permitindo bypass
  do fluxo oficial de pagamento. Correção: criação sempre nasce `PENDING`; `status` e `paidAt`
  foram removidos do DTO de criação e agora são rejeitados por `forbidNonWhitelisted`.
- `S1-UPL-001`: BrandAsset/Organization validava MIME/extensão, mas não assinatura binária.
  Correção: PDF, PNG e JPEG exigem magic bytes; SVG precisa ser SVG real e bloqueia `script`,
  event handlers, `javascript:` e `foreignObject`.

Evidências automatizadas:

- autenticação: token ausente, token malformado, usuário desativado com token já emitido e role
  claim adulterado;
- RBAC: Financial, Pricing, Budget e Procurement;
- confidencialidade comercial: Pricing bloqueado para OPERATOR/VIEWER e Product não vaza custo,
  preço mínimo ou margem;
- mass assignment financeiro: `status`/`paidAt` rejeitados e saldo não alterado;
- Assignment abuse: operador não executa Assignment de outro operador; transições repetidas ou
  fora de ordem não criam histórico falso;
- upload/storage: MIME spoofing, SVG ativo, storage key gerada pelo servidor e upload restrito a
  OWNER;
- paginação/filtros: page/limit abusivos, UUID e enum inválidos;
- error leakage: respostas públicas não expõem Prisma, SQL, `DATABASE_URL` ou paths de projeto.

Migrations:

- nenhuma migration criada nesta sprint.

Verificação executada nesta etapa:

- `TEST_DATABASE_URL='postgresql://orbit_test:orbit_test@127.0.0.1:5432/orbit_closure_test?schema=public' npm run test:security`
  - 6 suites / 19 tests.

Status:

- sem S0/S1 conhecidos abertos nos escopos exercitados por teste automatizado;
- Sprint 20 retornou `ORBIT_APPSEC_NOT_VERIFIED` por lacunas de cobertura, não por S0/S1 aberto;
- a matriz completa de fechamento foi executada posteriormente na Sprint 20.5.

## Sprint 19 — Backend Hardening, Concurrency & Data Integrity

Status: hardening crítico implementado parcialmente com foco nos invariantes C0/C1 identificados em
Financial, Inventory, Procurement, Assignments, Budgets, Pricing e Document Engine.

Domínios inspecionados:

- Operations e integração com Assignment/Maintenance;
- Assignments e histórico;
- Inventory e Operation Materials;
- Procurement e recebimentos;
- Financial e liquidação/cancelamento;
- Budgets e aprovação/rejeição/cancelamento;
- Pricing e vigência temporal;
- Document Engine e emissão oficial;
- Maintenance Planning e PMOC em nível de fronteira;
- Asset Lifecycle via `LifecyclePublisher`.

Correções implementadas:

- Financial: `payEntry` e `cancelEntry` agora usam transação `Serializable` e transição condicional
  por status antes de aplicar saldo/histórico/lifecycle.
- Inventory: criação de movimento aplica delta diretamente em `InventoryItem` com guarda
  condicional contra saldo negativo antes de criar `StockMovement`.
- Inventory: remoção de material de Operation passou a ser compare-and-set por `deletedAt`,
  impedindo duplicidade de `RETURN`.
- Procurement: recebimento revalida pedido/itens dentro da transação `Serializable`, incrementa
  `receivedQuantity` por compare-and-set e só então gera `StockMovement(IN)`.
- Assignments: accept/start/complete/reject/reassign usam compare-and-set por `status` e
  `assignedTo`, protegendo operador antigo contra corrida após reatribuição.
- Budgets: approve/reject/cancel usam transação `Serializable` e transição condicional por status.
- Pricing: criação/revisão de preço usam transação `Serializable` para o par validação de overlap
  - gravação.
- Document Engine: renderização oficial usa proteção contra stale metadata write via
  `updatedAt`; se outro render vencer a corrida, o PDF recém-criado é removido e o cliente recebe
  conflito controlado para retry.

Migration criada:

- `20260705190000_sprint19_integrity_constraints`
  - índice parcial `budgets_one_approved_per_operation`;
  - índice único lógico `inventory_items_one_active_per_location`;
  - constraint exclusion `product_pricings_no_active_overlap` com `btree_gist`.

Matriz resumida de invariantes:

- Financial: saldo só muda após transição de lançamento pendente/vencido para pago; pagamento
  duplicado e corrida pagamento/cancelamento retornam conflito.
- Inventory: `availableQuantity = currentQuantity - reservedQuantity`; movimentos negativos só
  persistem se `currentQuantity` e `availableQuantity` suportarem o delta.
- Procurement: `receivedQuantity <= quantity`; recebimento, estoque, histórico e auditoria ocorrem
  na mesma transação.
- Assignment: operador autorizado precisa continuar sendo `assignedTo` no momento da transição.
- Budget: budgets finais são imutáveis; apenas um budget aprovado por Operation é permitido.
- Pricing: períodos ativos do mesmo produto/organização não podem se sobrepor.
- Document Engine: um documento lógico por Budget; render concorrente não sobrescreve metadata
  já alterada.

Validação executada nesta sprint:

- `DATABASE_URL=postgresql://postgres:postgres@localhost:5432/orbit_validation npx prisma validate`;
- `DATABASE_URL=postgresql://postgres:postgres@localhost:5432/orbit_validation npx prisma generate`;
- `npm run build`;
- `npm run lint`;
- `npm test`.
- `DATABASE_URL=<postgres-local-limpo> npx prisma migrate deploy` fora do sandbox.

Validação pendente/bloqueada:

- testes reais de concorrência com PostgreSQL;
- testes de rollback com falha de storage/banco.

Observação: o Docker daemon não estava disponível inicialmente (`Cannot connect to the Docker
daemon`). Após acionar o Docker Desktop, as migrations foram aplicadas com sucesso em banco limpo.
Os testes unitários existentes passaram, mas ainda não há suíte real de concorrência PostgreSQL
suficiente para emitir o veredito final `ORBIT_BACKEND_INTEGRITY_READY`.

## Sprint 19.5 — PostgreSQL Concurrency, Transaction & Failure Verification

Infraestrutura oficial criada:

- `npm run test:integration`;
- `npm run test:concurrency`;
- `test/jest-integration.json`;
- `test/integration/setup.ts` com safety guard obrigatório em `TEST_DATABASE_URL`;
- o banco precisa terminar com `_test`;
- a suíte nunca usa `DATABASE_URL` automaticamente;
- migrations reais são aplicadas antes da suíte via `prisma migrate deploy`;
- cleanup determinístico com `TRUNCATE ... RESTART IDENTITY CASCADE`.

Testes reais PostgreSQL adicionados:

- `test/integration/database-integrity.integration.spec.ts`;
- `test/concurrency/critical-workflows.concurrency.spec.ts`.

Cenários comprovados:

- Financial double payment concorrente: somente um pagamento vence; saldo/histórico/auditoria
  persistem uma vez.
- Financial pagamento versus cancelamento: somente uma transição terminal vence.
- Financial pagamentos independentes na mesma conta: saldo final usa aritmética decimal exata.
- Inventory overspend: consumo 7 + 6 contra estoque 10 não deixa saldo negativo.
- Inventory duplicate return: remoção concorrente de material gera um único `RETURN`.
- Procurement over-receipt: recebimento 7 + 6 contra compra 10 não ultrapassa quantidade comprada.
- Assignment reassign versus accept: operador antigo não fica autorizado após reatribuição vencedora.
- Budget approve/approve: uma decisão efetiva.
- Budget um aprovado por Operation: índice parcial impede violação.
- Pricing overlap: exclusion constraint impede vigência ativa sobreposta.
- Maintenance recurrence: limites atuais de `DAILY`, `WEEKLY`, `MONTHLY`, `YEARLY`,
  `INTERVAL_DAYS` e `INTERVAL_MONTHS` documentados conforme semântica JS UTC existente.
- Constraint de InventoryItem ativo por organização/produto/local, incluindo `location = null`.
- Rollback PostgreSQL básico: writes dentro de transação são revertidos ao lançar erro.

Finding descoberto e corrigido:

- C0 Financial: pagamentos independentes concorrentes na mesma conta podiam falhar com `P2034`
  sob `Serializable`. Foi adicionado retry bounded no `FinancialService` somente para
  `PrismaClientKnownRequestError P2034`; erros de domínio e validação não são reexecutados.

Validação executada:

- `DATABASE_URL=<test-db> npx prisma validate`;
- `DATABASE_URL=<test-db> npx prisma generate`;
- `npm run build`;
- `npm run lint`;
- `npm test` — 10 suites, 27 tests;
- `npm run test:integration` — 1 suite, 4 tests;
- `npm run test:concurrency` — 1 suite, 11 tests, executado múltiplas vezes durante a sprint;
- `prisma migrate deploy` executado pelo setup real contra banco `_test`.

Veredito:

- `ORBIT_BACKEND_INTEGRITY_READY` ainda não foi emitido.
- Status: `ORBIT_BACKEND_INTEGRITY_NOT_READY`.

Bloqueios restantes para o veredito:

- Document Engine concurrent render/failure injection ainda não coberto;
- falha storage write e falha database-after-storage ainda não cobertas;
- download com binário ausente ainda não coberto;
- rollback específico de Procurement/Inventory/Budget via service boundary ainda não coberto;
- valid partial receipts 4/3/3 ainda não coberto;
- duplicate Assignment start/complete e cardinalidade completa de Operation/Maintenance ainda não
  cobertas;
- approve/reject e approve/cancel ainda não cobertos;
- concurrent Pricing revision e boundary adjacency/open-ended ainda não totalmente cobertos;
- duplicate Maintenance completion ainda não coberto.

## Sprint 19.6 — Integrity Certification Closure

Status: bloqueios de integridade remanescentes fechados com PostgreSQL real.

Infraestrutura reutilizada:

- `test/jest-integration.json`;
- `test/integration/setup.ts`;
- `test/integration/helpers.ts`;
- `test/integration/database-integrity.integration.spec.ts`;
- `test/concurrency/critical-workflows.concurrency.spec.ts`.

Extensões criadas:

- `test/concurrency/document-engine.concurrency.spec.ts`;
- `test/integration/transaction-rollback.integration.spec.ts`;
- `ControlledStorage` para falhas controladas exclusivamente na fronteira externa de storage.

Correção aplicada:

- Pricing passou a usar vigência half-open `[validFrom, validUntil)`.
- Migration corretiva: `20260705193000_pricing_half_open_validity`.
- `PricingService.assertNoOverlapTx` foi alinhado para permitir adjacência (`validUntil == next.validFrom`).
- Conflitos reais de banco/serialização em Pricing são mapeados para `PRICING_OVERLAP`.
- `DocumentEngineService.downloadDocument` passou a mapear falha inesperada de storage para erro
  controlado, sem vazar detalhes do provider.

Cenários fechados:

- Document concurrent render;
- Document storage write failure;
- Document DB failure after storage write;
- missing binary download;
- Procurement receipt rollback;
- Inventory material consumption rollback;
- Budget approval rollback;
- Assignment reassign/start;
- Assignment duplicate start;
- Assignment duplicate complete with Maintenance sync;
- Budget approve/reject;
- Budget approve/cancel;
- Budget snapshot stability through official builder/blueprint;
- Pricing adjacency;
- Pricing open-ended overlap;
- Pricing official revision;
- Pricing concurrent revision;
- duplicate Maintenance completion through Assignment completion;
- lifecycle/audit/history cardinality for covered race paths.

Validação final executada:

- `DATABASE_URL=<closure-test-db> npx prisma migrate deploy` em banco limpo `_test`: 23 migrations aplicadas;
- `DATABASE_URL=<closure-test-db> npx prisma validate`;
- `DATABASE_URL=<closure-test-db> npx prisma generate`;
- `npm run build`;
- `npm run lint`;
- `npm test`: 10 suites / 27 tests;
- `TEST_DATABASE_URL=<closure-test-db> npm run test:integration`: 2 suites / 7 tests;
- `TEST_DATABASE_URL=<closure-test-db> npm run test:concurrency`: 2 suites / 24 tests;
- `npm run test:concurrency` executado 5 vezes consecutivas sem falhas;
- `git diff --check`.

Veredito:

- `ORBIT_BACKEND_INTEGRITY_READY`.

## Backlog — Budget Document Emission

Fluxo oficial implementado:

- Budget solicita emissão via `DocumentEngineService`;
- Document Engine monta `BudgetContext`;
- `DocumentBuilder.buildBudget()` gera o blueprint usando somente snapshots do Budget;
- Renderer/PDF Engine continuam como única camada de renderização;
- `OperationDocument` passa a aceitar `budgetId` e `operationId` nullable para documentos comerciais sem Operation;
- download de Budget passa exclusivamente pelo Document Engine.

Migration criada:

- `20260702120000_budget_document_emission`.

Schema:

- `BudgetHistoryAction.DOCUMENT_RENDERED`;
- `AssetLifecycleEventType.DOCUMENT_RENDERED`;
- `OperationDocument.budgetId` único;
- relação `Budget.document`;
- `OperationDocument.operationId` opcional para Budget independente.

Endpoints adicionados:

| Method | Path                           | Access         |
| ------ | ------------------------------ | -------------- |
| POST   | `/api/v1/budgets/:id/render`   | OWNER, MANAGER |
| GET    | `/api/v1/budgets/:id/download` | OWNER, MANAGER |

Decisões:

- Budget não conversa diretamente com `DocumentBuilder`;
- PDF não é gerado no módulo Budget;
- render usa snapshots de `BudgetItem`, nunca consulta `ProductPricing`;
- orçamentos `CANCELED` e `REJECTED` não podem emitir documento;
- emissão cria `BudgetHistory.DOCUMENT_RENDERED` e auditoria;
- lifecycle `DOCUMENT_RENDERED` é publicado via `LifecyclePublisher`;
- paginação de tabelas utiliza os blocos do `LayoutEngine`/Renderer, repetindo cabeçalhos e preservando totais em bloco `keepTogether`.

Verificação executada:

- `DATABASE_URL=postgresql://postgres:postgres@localhost:5432/orbit npx prisma validate`;
- `npx prisma generate`;
- `npm run build`;
- `npm run lint`;
- `npm test`.

## Backend Sprint 14.5 — Architectural Consolidation & Standardization

Sprint de consolidação concluída sem criação de módulo de negócio e sem alteração funcional
intencional de domínios.

Revisão arquitetural:

- módulos existentes inspecionados: Customers, Equipments, Assignments, Operations,
  Asset Lifecycle, Maintenance Planning, PMOC, Inventory, Pricing, Budget, Document Engine,
  Signatures e Users;
- nenhuma dependência cíclica nova identificada;
- publicação de Asset Lifecycle permanece centralizada no `LifecyclePublisher`;
- `TimelineAssembler` permanece a única camada que monta payload de timeline para frontend;
- Document Engine mantém separação entre Context/Builder/Renderer/PDF Engine.

Padronizações aplicadas:

- criado `src/shared/types/pagination.types.ts`;
- criada função `buildPaginationMeta`;
- criada função `buildPaginatedResponse`;
- respostas paginadas agora usam semântica comum com `totalPages` mínimo `1`;
- serviços paginados migrados para helper compartilhado quando não havia payload extra;
- serviços com payload extra, como Asset Lifecycle, usam `buildPaginationMeta`.

Serviços ajustados:

- `CustomersService`;
- `EquipmentsService`;
- `AssignmentsService`;
- `AssetLifecycleService`;
- `OperationsService`;
- `UsersService`;
- `SignaturesService`;
- `PricingService`;
- `InventoryService`;
- `BudgetsService`;
- `MaintenancePlanningService`;
- `PmocComplianceService`.

Testes:

- adicionado `test/pagination.types.spec.ts`;
- cobertura de infraestrutura garante formato compartilhado e `totalPages` mínimo `1`.

Migrations:

- nenhuma migration criada nesta sprint.

Verificação executada:

- `DATABASE_URL=postgresql://postgres:postgres@localhost:5432/orbit npx prisma validate`;
- `npm run build`;
- `npm run lint`;
- `npm test`.

Recomendações para a próxima etapa:

- antes do Financeiro, considerar extração progressiva de DTOs base para paginação/filtros;
- revisar índices específicos quando as queries financeiras reais forem definidas;
- manter Financial isolado de Product/Inventory, consumindo Pricing por serviço interno;
- criar testes de integração para transições financeiras assim que o domínio existir.

## Backend Sprint 15 — Financial Core (Orbit V1)

Status: concluída em 2 de julho de 2026.

V1 Freeze Rule aplicada: nenhum recurso fiscal, contábil, bancário, PIX, NF-e ou conciliação foi
implementado. A sprint criou apenas o núcleo financeiro essencial.

Módulo criado:

- `src/modules/financial`.

Entidades:

- `FinancialAccount`;
- `FinancialCategory`;
- `FinancialEntry`;
- `FinancialEntryAllocation`;
- `FinancialHistory`.

Enums:

- `FinancialAccountType`: `CASH`, `BANK`, `CREDIT_CARD`, `DIGITAL_WALLET`, `OTHER`;
- `FinancialCategoryType`: `INCOME`, `EXPENSE`, `TRANSFER`;
- `FinancialEntryType`: `RECEIVABLE`, `PAYABLE`, `TRANSFER`;
- `FinancialEntryStatus`: `PENDING`, `PAID`, `CANCELED`, `OVERDUE`;
- `FinancialEntryOrigin`: `MANUAL`, `BUDGET`, `PURCHASE`, `OPERATION`, `PMOC`, `OTHER`;
- `FinancialHistoryAction`: `CREATED`, `UPDATED`, `PAID`, `CANCELED`, `RESTORED`.

Migration criada:

- `20260702160000_financial_core`.

Endpoints adicionados:

| Method | Path                                   | Access         |
| ------ | -------------------------------------- | -------------- |
| GET    | `/api/v1/financial/accounts`           | OWNER, MANAGER |
| POST   | `/api/v1/financial/accounts`           | OWNER, MANAGER |
| PATCH  | `/api/v1/financial/accounts/:id`       | OWNER, MANAGER |
| DELETE | `/api/v1/financial/accounts/:id`       | OWNER, MANAGER |
| GET    | `/api/v1/financial/categories`         | OWNER, MANAGER |
| POST   | `/api/v1/financial/categories`         | OWNER, MANAGER |
| PATCH  | `/api/v1/financial/categories/:id`     | OWNER, MANAGER |
| DELETE | `/api/v1/financial/categories/:id`     | OWNER, MANAGER |
| GET    | `/api/v1/financial/entries`            | OWNER, MANAGER |
| GET    | `/api/v1/financial/entries/:id`        | OWNER, MANAGER |
| POST   | `/api/v1/financial/entries`            | OWNER, MANAGER |
| PATCH  | `/api/v1/financial/entries/:id`        | OWNER, MANAGER |
| PATCH  | `/api/v1/financial/entries/:id/pay`    | OWNER, MANAGER |
| PATCH  | `/api/v1/financial/entries/:id/cancel` | OWNER, MANAGER |
| GET    | `/api/v1/financial/stats`              | OWNER, MANAGER |
| GET    | `/api/v1/financial/history/:id`        | OWNER, MANAGER |

Decisões:

- Financial é o único domínio autorizado a representar dinheiro operacional no Orbit;
- Product, Inventory e Budget continuam sem saldo financeiro;
- Budget aprovado não gera lançamento automaticamente nesta sprint;
- `FinancialOrigin.BUDGET` fica disponível para conversão futura;
- `originId` opcional permite referência futura a Budget/Operation/PMOC sem relacionamento
  polimórfico rígido;
- Asset Lifecycle financeiro é publicado somente quando o `LifecyclePublisher` consegue resolver
  equipamento pela origem; caso contrário, no-op seguro;
- `TRANSFER` está modelado, mas sem fluxo avançado de múltiplas contas nesta V1.

AppSec:

- RBAC restrito a `OWNER` e `MANAGER`;
- `OPERATOR` e `VIEWER` não acessam financeiro;
- DTO validation para UUID, datas, valores monetários e enums;
- transações em criação/pagamento/cancelamento;
- proteção contra pagamento duplicado;
- proteção contra cancelar lançamento pago;
- histórico financeiro imutável;
- soft delete em contas/categorias e cancelamento lógico em lançamentos;
- auditoria para contas, categorias e lançamentos.

Seeds:

- contas financeiras padrão;
- categorias de receita/despesa;
- lançamentos pendentes coerentes, incluindo origem `BUDGET` quando houver orçamento.

Testes:

- `financial.service.spec.ts` cobre pagamento duplicado e cancelamento de lançamento pago;
- testes totais: 9 suites, 25 testes.

Verificação executada:

- `DATABASE_URL=postgresql://postgres:postgres@localhost:5432/orbit npx prisma validate`;
- `npx prisma generate`;
- `npm run build`;
- `npm run lint`;
- `npm test`.

## Backend Sprint 16 — Procurement & Purchasing Domain (Orbit V1)

Status: concluída em 2 de julho de 2026.

Último grande domínio de negócio da V1 implementado sem aprovação de compras, cotações, fiscal,
NF-e, impostos ou financeiro automático.

Módulo criado:

- `src/modules/procurement`.

Entidades:

- `PurchaseOrder`;
- `PurchaseOrderItem`;
- `PurchaseReceipt`;
- `PurchaseHistory`.

Enums:

- `PurchaseOrderStatus`: `DRAFT`, `SENT`, `PARTIALLY_RECEIVED`, `RECEIVED`, `CANCELED`;
- `PurchaseHistoryAction`: `CREATED`, `UPDATED`, `SENT`, `PARTIALLY_RECEIVED`, `RECEIVED`, `CANCELED`.

Migration criada:

- `20260702180000_procurement_domain`.

Endpoints adicionados:

| Method | Path                                   |
| ------ | -------------------------------------- |
| GET    | `/api/v1/purchase-orders`              |
| GET    | `/api/v1/purchase-orders/:id`          |
| POST   | `/api/v1/purchase-orders`              |
| PATCH  | `/api/v1/purchase-orders/:id`          |
| PATCH  | `/api/v1/purchase-orders/:id/send`     |
| PATCH  | `/api/v1/purchase-orders/:id/cancel`   |
| GET    | `/api/v1/purchase-orders/:id/items`    |
| POST   | `/api/v1/purchase-orders/:id/items`    |
| PATCH  | `/api/v1/purchase-order-items/:id`     |
| DELETE | `/api/v1/purchase-order-items/:id`     |
| GET    | `/api/v1/purchase-orders/:id/receipts` |
| POST   | `/api/v1/purchase-orders/:id/receipts` |
| GET    | `/api/v1/purchase-orders/stats`        |
| GET    | `/api/v1/purchase-orders/history/:id`  |

Integrações:

- Inventory: recebimento chama `InventoryService.createMovementInTransaction` com
  `StockMovementType.IN`; Procurement não recalcula estoque por conta própria;
- Inventory: `InventoryService.ensureInventoryItemInTransaction` prepara o item físico padrão para
  o produto recebido;
- Financial: `FinancialEntryOrigin.PURCHASE` já existe e fica disponível para conversão futura, sem
  lançamento automático nesta sprint;
- Asset Lifecycle: eventos `PURCHASE_CREATED`, `PURCHASE_RECEIVED`, `PURCHASE_CANCELED` foram
  adicionados ao enum. Como compras V1 não são vinculadas a equipamento, o publisher registra no-op
  auditável e não cria evento órfão.

Regras:

- recebimento parcial suportado;
- `receivedQuantity` é atualizado por item;
- pedido vira `PARTIALLY_RECEIVED` ou `RECEIVED` conforme quantidades;
- bloqueio contra recebimento acima da quantidade comprada;
- bloqueio contra alteração/exclusão de item recebido;
- pedido recebido ou cancelado não pode ser alterado;
- histórico de compra é imutável.

Seeds:

- pedido de compra inicial;
- itens;
- recebimento parcial;
- movimento de estoque de entrada coerente.

Testes:

- `procurement.service.spec.ts`;
- cobertura de recebimento em status inválido;
- cobertura de recebimento acima da quantidade comprada.

Verificação executada:

- `DATABASE_URL=postgresql://postgres:postgres@localhost:5432/orbit npx prisma validate`;
- `npx prisma generate`;
- `npm run build`;
- `npm run lint`;
- `npm test`.

## Backend Sprint 14 — Budget Domain

Domínio criado:

- `src/modules/budgets`;
- `BudgetsModule` importado no `AppModule`;
- `BudgetsService` como único ponto de regra comercial de orçamento;
- `BudgetsController` expondo a API oficial;
- constantes de auditoria em `src/shared/constants/budgets.constants.ts`.

Entidades:

- `Budget`;
- `BudgetItem`;
- `BudgetApproval`;
- `BudgetHistory`.

Enums:

- `BudgetStatus`: `DRAFT`, `PENDING`, `APPROVED`, `REJECTED`, `EXPIRED`, `CANCELED`;
- `BudgetHistoryAction`: `CREATED`, `UPDATED`, `SUBMITTED`, `APPROVED`, `REJECTED`,
  `EXPIRED`, `CANCELED`, `ITEM_ADDED`, `ITEM_UPDATED`, `ITEM_REMOVED`;
- `DocumentTemplateType` expandido com `BUDGET`;
- `AssetLifecycleEventType` expandido com `BUDGET_APPROVED` e `BUDGET_REJECTED`.

Migration criada:

- `20260702100000_budget_domain`.

Decisões arquiteturais:

- Budget é independente de Operation; uma Operation pode ter zero, um ou vários orçamentos;
- somente um orçamento pode ser aprovado por Operation;
- preço/custo/margem ficam em snapshot no `BudgetItem`;
- criação/atualização de itens usa `PricingService.resolveForConsumer(productId, 'BUDGET')`;
- renderização futura não deve consultar `ProductPricing`; deve usar snapshots do orçamento;
- `DELETE /budgets/:id` não remove fisicamente: cancela o orçamento quando ele ainda é editável;
- histórico e aprovações são imutáveis.

Integrações:

- Operation referencia orçamentos por relação `Operation.budgets`;
- Document Engine passa a possuir template `DocumentTemplateType.BUDGET`;
- Asset Lifecycle recebe eventos `BUDGET_APPROVED` e `BUDGET_REJECTED` via `LifecyclePublisher`;
- seed cria orçamento operacional idempotente usando produtos, pricing, customers e operations existentes.

Endpoints adicionados:

| Method | Path                             | Access         |
| ------ | -------------------------------- | -------------- |
| GET    | `/api/v1/budgets`                | OWNER, MANAGER |
| GET    | `/api/v1/budgets/:id`            | OWNER, MANAGER |
| GET    | `/api/v1/operations/:id/budgets` | OWNER, MANAGER |
| POST   | `/api/v1/budgets`                | OWNER, MANAGER |
| PATCH  | `/api/v1/budgets/:id`            | OWNER, MANAGER |
| PATCH  | `/api/v1/budgets/:id/approve`    | OWNER, MANAGER |
| PATCH  | `/api/v1/budgets/:id/reject`     | OWNER, MANAGER |
| DELETE | `/api/v1/budgets/:id`            | OWNER, MANAGER |
| GET    | `/api/v1/budgets/stats`          | OWNER, MANAGER |
| GET    | `/api/v1/budgets/history/:id`    | OWNER, MANAGER |

AppSec:

- RBAC bloqueia OPERATOR/VIEWER do domínio comercial;
- DTOs validam UUID, paginação, datas, valores monetários e arrays de itens;
- valida relacionamento consistente entre customer, address, equipment e operation;
- orçamento aprovado não pode ser editado/cancelado;
- orçamento vencido não pode ser aprovado;
- aprovação múltipla para a mesma Operation é bloqueada;
- auditoria registra criação, alteração, aprovação, rejeição e cancelamento.

Verificação executada:

- `DATABASE_URL=postgresql://postgres:postgres@localhost:5432/orbit npx prisma validate`;
- `npx prisma generate`;
- `npm run build`;
- `npm run lint`;
- `npm test`.
- `npm test`.
- `npm test`.

## Sprint 13 — Pricing Domain

Domínio criado:

- `src/modules/pricing`;
- `PricingModule` importado no `AppModule`;
- `PricingService` como serviço central para resolver preço vigente, custo vigente, margem,
  vigência e histórico;
- `PricingController` expondo a API oficial;
- contratos internos em `pricing.types.ts` para futuros consumidores (`BUDGET`, `FINANCIAL`,
  `INVENTORY`, `OPERATION`);
- constantes de auditoria em `src/shared/constants/pricing.constants.ts`.

Entidade:

- `ProductPricing`.

Campos comerciais:

- `costPrice`;
- `replacementCost`;
- `averageCost`;
- `salePrice`;
- `minimumSalePrice`;
- `suggestedSalePrice`;
- `marginPercentage`;
- `validFrom`;
- `validUntil`;
- `active`.

Migration criada:

- `20260701150000_pricing_domain`.

Decisões arquiteturais:

- Product permanece catálogo técnico, sem preço;
- Inventory permanece estoque físico, sem custo;
- Pricing é a única fonte comercial;
- alterações de preço criam nova vigência em `ProductPricing`;
- `PATCH /pricing/:id` cria uma revisão com nova vigência e desativa o registro anterior;
- `PricingService.resolveForConsumer` prepara consumo interno futuro por Budget, Financial,
  Inventory e Operations;
- vigências ativas sobrepostas são rejeitadas.

Endpoints adicionados:

| Method | Path                                 | Access         |
| ------ | ------------------------------------ | -------------- |
| GET    | `/api/v1/pricing/stats`              | OWNER, MANAGER |
| GET    | `/api/v1/pricing`                    | OWNER, MANAGER |
| GET    | `/api/v1/pricing/:id`                | OWNER, MANAGER |
| GET    | `/api/v1/products/:id/pricing`       | OWNER, MANAGER |
| POST   | `/api/v1/products/:id/pricing`       | OWNER          |
| PATCH  | `/api/v1/pricing/:id`                | OWNER          |
| GET    | `/api/v1/pricing/history/:productId` | OWNER, MANAGER |

Auditoria:

- `PRICING_CREATED`;
- `PRICING_UPDATED`;
- `PRICING_DEACTIVATED`;
- `PRICING_RESOLVED` reservado para uso futuro controlado.

Seed:

- seed idempotente cria preços coerentes para produtos existentes;
- não cria novo Demo Dataset;
- dados comerciais são inseridos apenas em `ProductPricing`.

Verificação executada:

- `DATABASE_URL=postgresql://user:pass@localhost:5432/db npx prisma validate`;
- `DATABASE_URL=postgresql://user:pass@localhost:5432/db npx prisma generate`;
- `npm run build`;
- `npm run lint`.

## Backlog — Delegação de Operações (OWNER / MANAGER)

Escopo concluído:

- `CreateOperationDto` passou a aceitar `operatorId?: uuid`;
- `OperationsService.create` agora resolve o operador responsável antes de criar a Operation;
- `OWNER` e `MANAGER` podem delegar a Operation para outro usuário operacional;
- se `operatorId` não for informado, o operador permanece sendo o usuário autenticado;
- `OPERATOR` continua criando apenas em nome próprio; se enviar `operatorId`, o backend ignora a
  delegação e mantém `actor.id`;
- `VIEWER` permanece sem permissão de criação pelo `RoleGuard`.

Validações aplicadas:

- `operatorId` validado como UUID pelo DTO;
- usuário delegado precisa existir;
- usuário delegado precisa estar ativo;
- usuário delegado não pode estar desativado (`disabledAt`);
- usuário delegado precisa possuir perfil operacional (`OWNER`, `MANAGER` ou `OPERATOR`);
- por arquitetura single-company, usuários pertencem ao banco isolado da instalação; não existe
  atribuição cross-tenant em banco compartilhado.

Auditoria:

- `OPERATION_CREATED` registra `createdBy`, `operatorId`, `delegated` e `ignoredOperatorId`;
- `OPERATION_DELEGATED` é registrado somente quando `actor.id !== operatorId`.

Migrations:

- nenhuma migration criada; alteração apenas contratual/serviço.

Documentação atualizada:

- `API_CONTRACTS.md`;
- `FRONTEND_INTEGRATION.md`;
- `OPUS_INTEGRATION.md`;
- `SECURITY.md`;
- `STATE.md`.

Verificação executada:

- `DATABASE_URL=postgresql://user:pass@localhost:5432/db npx prisma validate`;
- `npm run build`;
- `npm run lint`;
- `npm test`;
- `git diff --check`.

## Sprint — Assignment Domain + Operator Workflow

Domínio criado:

- `src/modules/assignments`;
- `AssignmentsModule` importado no `AppModule`;
- `AssignmentsService` como único ponto de escrita de Assignment;
- `AssignmentsController` expondo a API oficial;
- constantes de auditoria em `src/shared/constants/assignments.constants.ts`.

Entidades:

- `Assignment`;
- `AssignmentHistory`.

Enums:

- `AssignmentStatus`: `ASSIGNED`, `ACCEPTED`, `STARTED`, `PAUSED`, `COMPLETED`, `CANCELED`,
  `REJECTED`;
- `AssignmentEventType`: `ASSIGNED`, `REASSIGNED`, `ACCEPTED`, `STARTED`, `PAUSED`, `RESUMED`,
  `REJECTED`, `COMPLETED`, `CANCELED`;
- `AssetLifecycleEventType` expandido com `ASSIGNMENT_CREATED`, `ASSIGNMENT_REASSIGNED`,
  `ASSIGNMENT_ACCEPTED`, `ASSIGNMENT_STARTED`, `ASSIGNMENT_COMPLETED`.

Migration criada:

- `20260701170000_assignment_domain`.

Integração com Operations:

- `OperationsService.create` cria Assignment automaticamente dentro da mesma transação;
- `operatorId` da Operation continua sendo a referência operacional principal;
- reatribuição atualiza `Operation.operatorId`;
- conclusão de Assignment atualiza a Operation para `COMPLETED` e sincroniza Asset Lifecycle e
  Maintenance Planning existentes.

Histórico:

- toda mudança cria `AssignmentHistory`;
- histórico nunca é sobrescrito;
- controller não altera Assignment diretamente.

Endpoints adicionados:

| Method | Path                                       | Access                           |
| ------ | ------------------------------------------ | -------------------------------- |
| GET    | `/api/v1/assignments`                      | OWNER, MANAGER, OPERATOR, VIEWER |
| GET    | `/api/v1/assignments/my`                   | OWNER, MANAGER, OPERATOR         |
| GET    | `/api/v1/assignments/:id`                  | OWNER, MANAGER, OPERATOR, VIEWER |
| GET    | `/api/v1/assignments/history/:operationId` | OWNER, MANAGER, OPERATOR, VIEWER |
| POST   | `/api/v1/assignments`                      | OWNER, MANAGER                   |
| PATCH  | `/api/v1/assignments/:id/reassign`         | OWNER, MANAGER                   |
| PATCH  | `/api/v1/assignments/:id/accept`           | OWNER, MANAGER, OPERATOR         |
| PATCH  | `/api/v1/assignments/:id/reject`           | OWNER, MANAGER, OPERATOR         |
| PATCH  | `/api/v1/assignments/:id/start`            | OWNER, MANAGER, OPERATOR         |
| PATCH  | `/api/v1/assignments/:id/complete`         | OWNER, MANAGER, OPERATOR         |

AppSec:

- UUID validation;
- RBAC;
- proteção contra aceitar/iniciar/concluir Assignment de outro operador;
- proteção contra iniciar sem aceitar;
- proteção contra concluir sem iniciar;
- transações para estado, histórico, auditoria e lifecycle;
- usuário delegado precisa estar ativo e possuir perfil operacional.

Verificação executada:

- `DATABASE_URL=postgresql://user:pass@localhost:5432/db npx prisma validate`;
- `DATABASE_URL=postgresql://user:pass@localhost:5432/db npx prisma generate`;
- `npm run build`;
- `npm run lint`.
- `npm test`.

## Sprint 20.5 — AppSec Verification Closure

Status: concluída em 5 de julho de 2026 como sprint de fechamento AppSec, sem novos domínios de
negócio e sem migrations.

Objetivo:

- fechar lacunas de verificação remanescentes da Sprint 20;
- confirmar, por testes HTTP reais, autorização, validação, confidencialidade, auditoria e efeitos
  colaterais em superfícies críticas;
- corrigir apenas defeitos comprovados por evidência.

Infraestrutura reutilizada:

- `backend/test/jest-security.json`;
- `backend/test/security/security-app.ts`;
- helpers reais de autenticação/fixtures/cleanup;
- NestJS real via HTTP/Supertest;
- Prisma e PostgreSQL real.

Suites criadas:

- `backend/test/security/document-engine-closure.security.spec.ts`;
- `backend/test/security/signatures-closure.security.spec.ts`;
- `backend/test/security/maintenance-pmoc-closure.security.spec.ts`;
- `backend/test/security/inventory-procurement-closure.security.spec.ts`;
- `backend/test/security/asset-lifecycle-closure.security.spec.ts`;
- `backend/test/security/audit-rate-closure.security.spec.ts`.

Correção aplicada:

- `AssetLifecycleService` deixou de espalhar o evento Prisma bruto no payload público;
- listagem/detalhe de Asset Lifecycle agora retornam payload sanitizado;
- anexos retornados por upload/listagem não expõem `storageKey`, `eventId` nem `deletedAt`;
- nomes originais de anexos são sanitizados antes do retorno público;
- `frontend/packages/types/index.ts` removeu e-mail do performer em Asset Lifecycle;
- `frontend/app/(platform)/reports/visita/page.tsx` passou a revogar object URLs ao remover foto e
  no unmount.

Finding:

- `S1-LIFE-001` — Asset Lifecycle public API leaked raw metadata/storage keys/performer email.
  Status: corrigido e coberto por regressão.

Verificação executada:

- `TEST_DATABASE_URL=postgresql://orbit_test:orbit_test@127.0.0.1:5432/orbit_closure_test?schema=public npm run test:security -- --silent`
  passou com 12 suites / 38 testes.

Resultado:

- `ORBIT_APPSEC_VERIFIED`, condicionado à manutenção das políticas documentadas em `SECURITY.md`.

## Sprint 22 — Production Readiness, Release Candidate Certification & Operational Hardening

Status: executada em 6 de julho de 2026 como gate de Release Candidate V1.

Escopo:

- sem novos domínios de negócio;
- sem migrations novas;
- hardening de configuração, runtime, CI, runbooks, smoke tests e workflows críticos;
- validação local representativa com PostgreSQL real, API real e frontend buildado.

Arquivos/artefatos criados:

- `.github/workflows/release-candidate.yml`;
- `docker-compose.rc.yml`;
- `deploy/nginx/orbit.conf`;
- `docs/release/PRODUCTION_READINESS_RUNBOOK.md`;
- `docs/release/SPRINT_22_RELEASE_CANDIDATE_CERTIFICATION.md`;
- `backend/test/release/release-api-client.mjs`;
- `backend/test/release/frontend-smoke.mjs`;
- `backend/test/release/critical-workflows.mjs`.

Hardening aplicado:

- `NODE_ENV` agora faz parte do contrato obrigatório de ambiente;
- produção rejeita JWT secrets placeholder/example;
- produção rejeita `DATABASE_URL` com placeholders/local/example;
- frontend deixou de habilitar demo bridge por padrão;
- `NEXT_PUBLIC_API_BASE_URL` pode ser relativo (`/api/v1`) quando houver reverse proxy same-origin;
- adicionada topologia RC com proxy reverso e Postgres/API não expostos diretamente ao host;
- removido `.DS_Store` de `backend/prisma/migrations`.

Validações executadas:

- `npx prisma validate` com `DATABASE_URL` explícita;
- `npm run build` backend;
- `npm run lint` backend;
- `npm run build` frontend;
- `npm run lint` frontend;
- migrations limpas em banco `orbit_rc_test` com 23 migrations aplicadas;
- `npm test`: 10 suites / 27 testes;
- `npm run test:security`: 12 suites / 38 testes;
- `npm run test:concurrency`: 2 suites / 24 testes;
- `npm run test:integration`: 2 suites / 7 testes;
- `npm run perf:seed`;
- `npm run perf:profile`;
- `npm run perf:run`: dashboard, 2 VUs, 10s, 2380 requests, p95 108.3ms, errorRate 0;
- `npm run release:smoke:frontend`;
- `npm run release:workflows`;
- `docker build -t orbit-api:rc-sprint22 ./backend`;
- `docker build -t orbit-frontend:rc-sprint22 --build-arg NEXT_PUBLIC_API_BASE_URL=/api/v1 --build-arg NEXT_PUBLIC_ENABLE_DEMO=false ./frontend`;
- backup/restore via `pg_dump -Fc`/`pg_restore` no container PostgreSQL;
- fresh install com migrations + seed inicial sem Demo Dataset.

Workflow crítico certificado:

- login OWNER;
- criação de operador e troca obrigatória de senha;
- criação de cliente, endereço, equipamento e lookup por QR;
- product catalog, pricing e entrada de estoque;
- operação delegada, assignment accept/start/complete;
- consumo de material e Asset Lifecycle;
- orçamento, aprovação, render e download documental oficial;
- financeiro: conta, categoria, lançamento e pagamento;
- compras: fornecedor, pedido, item, envio e recebimento parcial/total;
- superfícies de stats para dashboard.

Findings:

- `RC1-CI-001`: CI ausente — corrigido com workflow RC;
- `RC1-CONFIG-001`: demo bridge frontend defaultava ligado — corrigido;
- `RC1-CONFIG-002`: produção aceitava secrets placeholder — corrigido;
- `RC2-NET-001`: faltava topologia proxy representativa — corrigido localmente com compose RC;
- `RC2-RUNBOOK-001`: runbook release/rollback/backup ausente — corrigido;
- `RC2-MIGRATION-001`: `.DS_Store` contaminava migrations — removido;
- `RC3-DOC-001`: scripts assumiam `/health/metrics`; rota real é `/metrics` — corrigido;
- `RC3-FRONTEND-001`: `next start` alerta sobre standalone; Dockerfile usa server standalone.
- `RC2-SUPPLY-001`: build Docker frontend reportou 2 vulnerabilidades moderadas via `npm audit`;
  não corrigido nesta sprint para evitar upgrade de dependências fora do escopo.

Veredito:

- `ORBIT_RELEASE_CANDIDATE_NOT_READY`.

## Document Certification DC02B — Technical Visit Completion

Status: concluída em 13 de julho de 2026.

- migration `20260713173000_document_dc02b_contracts`;
- Organization evoluída com inscrição estadual e telefones adicionais;
- Operation evoluída com competência, tipo de manutenção, checklist estruturado e equipamentos
  inspecionados com snapshots;
- Corporate Header único aplicado a todos os contextos documentais oficiais;
- `TECHNICAL_REPORT` recebeu competência, checklists tipados e tabela paginada
  `ITEM/SETOR/MARCA/MODELO/CAPACIDADE`;
- novos campos opcionais preservam operações históricas;
- Preview, PDF, QR, fotos, assinaturas, Storage e catálogo permanecem no Document Engine oficial.

Validação: unit 17/65, integration 2/8, concurrency 2/24, security 12/38, builds backend/frontend e
runtime real Preview → Render → PDF → Download → `/documentos` aprovados. O PDF runtime possui cinco
páginas; paginação longa foi testada com 75 equipamentos.

Detalhes: `docs/release/DOCUMENT_CERTIFICATION_DC02B_TECHNICAL_VISIT_FINAL.md`.

## Product Backlog Closure 04 — Avatar Crop, Identity Sync e Notification Center

Status: implementada em 10 de julho de 2026.

Avatar:

- perfil passa a abrir crop/reposition UI antes de persistir avatar;
- avatar final é PNG 512×512;
- persistência continua em `POST /api/v1/users/avatar`;
- backend mantém validação de MIME, extensão, tamanho e assinatura binária;
- resposta pública de avatar não expõe `storageKey`;
- shell/header e menu usam estado autenticado oficial via `AuthProvider.refresh()`.

Notifications:

- criado domínio persistido `Notification`;
- criado índice único `(recipientUserId, eventKey)` para idempotência;
- endpoints criados: listagem, unread count, mark read e mark all read;
- eventos iniciais vêm de Assignment/Budget, não de AuditLog;
- overdue de Assignment é detectado por sync bounded/idempotente ao ler notificações.

## Product Backlog Closure 03 — Production PDF Exports & Signature Management UX

Status: concluído em 10 de julho de 2026.

Arquitetura de export:

- criado `src/modules/list-exports`;
- `ListExportService` consulta dados autoritativos no PostgreSQL, monta `RenderedDocument`
  administrativo e gera PDF pelo `PdfEngineService`;
- exports de listas não criam `OperationDocument`, não geram numeração documental oficial e não
  publicam Asset Lifecycle;
- limite V1: 500 registros por export PDF.

Endpoints criados:

- `GET /api/v1/operations/export`;
- `GET /api/v1/documents/export`;
- `GET /api/v1/equipments/export`.

Assinaturas:

- migration `20260710143000_signature_soft_delete` adiciona `Signature.deletedAt`;
- listagem normal de assinaturas exclui `deletedAt != null`;
- DELETE de assinatura marca `active=false` e `deletedAt=now`;
- contrato público de assinatura não expõe `imageStorageKey`; retorna `hasImage`.

## Product Backlog Closure 02 — Report Specialization & Production PDF Workflow

Status: concluído em 10 de julho de 2026.

Alterações backend:

- `DocumentContextService` passou a carregar dados reais adicionais para documentos operacionais:
  Assignment/histórico, materiais consumidos, MaintenanceExecution/Plan e PMOC vinculado ao MaintenancePlan.
- `DocumentBuilderService` passou a compor seções especializadas por `DocumentTemplateType`:
  - `WORK_ORDER`: programação, responsável e escopo/checklist;
  - `TECHNICAL_REPORT`: visita técnica, tempos, atividades, materiais e evidências;
  - `REPORT`: execução operacional, assignment, histórico e resultado;
  - `PMOC`: contexto PMOC real, manutenção e ambientes monitorados;
  - `RECEIPT`: confirmação de atendimento;
  - `QUOTE`: origem operacional, mantendo Budget como fonte comercial oficial;
  - `BUDGET`: preservado pelo fluxo especializado existente.

Decisões:

- Nenhum endpoint novo foi criado.
- Nenhuma migration foi criada.
- Nenhum renderer/PDF engine paralelo foi criado.
- Preview e render continuam usando o mesmo Builder/Blueprint/Renderer/PDF Engine.
- Cards frontend “Relatório Técnico” e “Laudo” continuam compartilhando `DocumentTemplateType.REPORT`; nova diferenciação exigiria novo enum/contrato e ficou fora desta closure.

Validação:

- `DATABASE_URL=... npx prisma validate`: passou;
- `DATABASE_URL=... npx prisma generate`: passou;
- `npm run lint`: passou;
- `npm run build`: passou;
- `npm test -- --silent`: 10 suites / 27 testes passaram.

## Document Semantics Closure — Model Preview vs Real Data Preview + Technical Opinion

Status: concluído em 10 de julho de 2026.

Alterações:

- `DocumentTemplateType` recebeu `TECHNICAL_OPINION` de forma aditiva.
- Migration criada: `20260710120000_document_semantics_technical_opinion`.
- `REPORT` foi preservado como tipo legado/histórico, sem renomear documentos existentes.
- `TECHNICAL_REPORT` representa relatório técnico factual/operacional.
- `TECHNICAL_OPINION` representa laudo técnico analítico baseado somente em dados reais disponíveis.
- Prefixo novo: `TECHNICAL_OPINION -> LDO`.
- Seeds idempotentes passam a criar template padrão de Laudo Técnico sem sobrescrever customizações existentes.
- `DocumentBuilderService` agora possui composição distinta para:
  - Technical Report;
  - Technical Opinion;
  - REPORT legado.

Garantias:

- model preview continua usando `TemplatePreviewContext`, sem OperationDocument/render/download;
- real preview continua usando Operation/Budget context oficial;
- nenhum dado histórico `REPORT` foi migrado destrutivamente;
- nenhum PDF é gerado fora do Document Engine.

Validação:

- `DATABASE_URL=... npx prisma validate`: passou;
- `DATABASE_URL=... npx prisma generate`: passou;
- `npm run lint`: passou;
- `npm run build`: passou;
- `npm test -- --silent`: 10 suites / 28 testes passaram.

Motivo:

- a base local passou nos gates técnicos executados, mas não houve evidência real de staging,
  domínio/TLS público, execução de CI externo, cloud IAM/storage ou operação em ambiente produtivo.
  Esses itens não podem ser simulados no repositório.

## Sprint 22.5 — External Release Candidate Closure

Status: executada em 10 de julho de 2026 como closure sprint dos bloqueadores externos da Sprint 22.

Decisões oficiais V1:

- Orbit V1 é single-company por instalação.
- V1 suporta instalação dedicada por cliente ou infraestrutura compartilhada apenas com instâncias
  isoladas por cliente.
- V1 não suporta multi-tenancy compartilhado em uma única aplicação/banco.
- Storage oficial V1: local/block persistente, montado fora da camada efêmera do container.
- Object storage não está certificado na V1.

Correções aplicadas:

- frontend recebeu override `postcss@8.5.16`;
- `npm audit --json` do frontend passou a reportar 0 vulnerabilidades;
- produção agora rejeita `STORAGE_PATH` relativo ou temporário;
- runbook e documentação de release registram modelo oficial de deployment/storage.

Validações executadas:

- `npm install` no frontend;
- `npm audit --json` no frontend: 0 vulnerabilidades;
- `npm run lint` no frontend: passou com 2 warnings existentes;
- `npm run build` no frontend: passou.

Bloqueadores externos ainda abertos:

- ambiente externo/staging não fornecido;
- TLS/proxy externo não validado;
- GitHub Actions não executado externamente;
- traceabilidade CI → imagem → deploy não estabelecida;
- rollback externo não executado;
- backup/restore externo de PostgreSQL + storage não executado;
- bootstrap OWNER externo não executado;
- smoke/workflows externos via HTTPS não executados.

Veredito:

- `ORBIT_RELEASE_CANDIDATE_NOT_READY`.

# Closure — Technical Report Creation UX (2026-07-14)

- Added the organization-scoped `MaintenanceChecklistTemplate` catalog and migration `20260714143000_maintenance_checklist_template_catalog`.
- Added authenticated CRUD at `/api/v1/maintenance-checklist-templates`; deletion is a soft deactivation so historical Operation snapshots remain immutable.
- The seed idempotently installs a small HVAC starter catalog only for an HVAC organization. Runtime operation does not depend on seed data.
- Technical Report creation now persists selected catalog entries as the existing `OperationMaintenanceChecklistItem` snapshots. No Document Engine contract or renderer was changed.
- Report photos remain supported by the existing Operation contract, but the Central de Relatórios workflow now submits photos only for PMOC.

## Product Backlog Closure 08 — Technical Catalogs (2026-07-15)

Status: concluído.

- Criado o domínio único `TechnicalCatalog`, com os tipos `CHECKLIST`, `OBJECTIVE`,
  `SITE_CONDITION`, `CONCLUSION` e `RECOMMENDATION`; não existem tabelas paralelas por tipo.
- Migration `20260715130000_technical_catalogs` aplicada em PostgreSQL: preserva os checklists
  existentes, remove somente a tabela legada após a cópia e instala 41 itens técnicos oficiais
  editáveis (5 objetivos, 21 condições, 7 conclusões e 8 recomendações).
- O endpoint legado `/maintenance-checklist-templates` foi preservado por um adapter sobre
  `TechnicalCatalog(CHECKLIST)`, sem quebra para integrações anteriores.
- Criados endpoints paginados `/technical-catalogs`, com busca, filtros, ordenação, ativação,
  reordenação e exclusão lógica.
- `Operation` recebeu `technicalOpinionRecommendations`; objetivo, condições, recomendações e
  conclusão são persistidos como snapshots textuais. Alterações futuras no catálogo não modificam
  operações ou documentos históricos.
- O Document Builder apenas consome os snapshots entregues pelo `DocumentContext`; não consulta o
  catálogo e nenhuma infraestrutura paralela de Preview/PDF foi criada.
- Auditorias: `TECHNICAL_CATALOG_CREATED`, `TECHNICAL_CATALOG_UPDATED`,
  `TECHNICAL_CATALOG_REORDERED` e `TECHNICAL_CATALOG_DELETED`.
- PostgreSQL validado com 35 migrations aplicadas e API saudável após deploy.

## Product Backlog Closure 08.1 — classificação e aplicabilidade (2026-07-15)

Status: concluído.

- `TechnicalCatalog` foi evoluído de forma aditiva com `tags[]`, `areas[]` e `workflows[]`.
- Taxonomia oficial: áreas `GENERAL`, `HVAC`, `ELECTRICAL`, `REFRIGERATION`, `MECHANICAL`,
  `HYDRAULIC`, `SAFETY`; workflows `GENERAL`, `WORK_ORDER`, `TECHNICAL_REPORT`,
  `TECHNICAL_OPINION`, `PMOC`, `MAINTENANCE`.
- Migration `20260715180000_technical_catalog_classification` aplicada sem remoção de registros.
  Todos os 47 itens conservaram fallback `GENERAL`; defaults inequívocos receberam classificações
  adicionais.
- Filtros server-side combinam área/workflow e pesquisa por tags, com prioridade contextual.
- `GET /technical-catalogs/taxonomy` centraliza labels para Platform e Operator.
- Laudo e Visita usam contexto no preenchimento. Snapshots e Document Engine não foram alterados.
- Índices GIN adicionados para tags, áreas e workflows; adapter legado preservado.

## DC-04 — Certificação PMOC (2026-07-15)

- O PMOC permanece especialização de `MaintenancePlan`; o preenchimento ocorre na
  `MaintenanceExecution` ligada a uma `Operation` e a emissão usa somente o Document Engine.
- `OperationMaintenanceChecklistItem` ganhou equipamento opcional e resultado
  `YES | NO | NOT_APPLICABLE`; conteúdo e observações são snapshots da execução.
- A assinatura coletada registra nome, função e horário do cliente/responsável, sem retornar o
  binário nas respostas de Operation.
- O Builder PMOC produz identificação, operação, equipamentos, ambientes, referência legal textual,
  checklist por equipamento, materiais, fotos, observações e assinaturas do template.
- Migration: `20260715193000_pmoc_document_certification`.

## Laudo Técnico — narrativa principal e itens complementares (2026-07-15)

- Objetivo e Conclusão agora separam o esclarecimento livre do responsável técnico dos itens
  predefinidos selecionados no catálogo.
- Novos snapshots em `Operation`: `technicalOpinionObjectiveItems[]` e
  `technicalOpinionConclusionItems[]`; o Builder não consulta o catálogo durante a emissão.
- O Blueprint renderiza primeiro o texto técnico principal e depois uma lista complementar.
- Migration: `20260715213000_technical_opinion_statement_items`.

## PMOC independente e origem da Ordem de Serviço (2026-07-16)

- `PmocPlan` ganhou `number` próprio, único e autoincremental.
- O nome oficial do `MaintenancePlan` segue `PMOC · Cliente · PMOC-000000`.
- PMOC não referencia uma OS de origem. O fluxo correto é `PmocPlan → MaintenanceExecution →
  Operation → WORK_ORDER`.
- A migration corretiva `20260716090000_pmoc_own_number` remove `sourceOperationId`, introduz a
  numeração e substitui a decisão temporária da migration `20260715223000_pmoc_source_operation`.
- A migration `20260716123000_pmoc_plan_name_backfill` aplica o padrão de nome também aos PMOCs
  históricos, preservando o número próprio e o limite de 140 caracteres do plano.
- A OS continua sendo criada pelo domínio oficial de Operations e permanece gerenciável em toda a
  plataforma.

## PMOC UX-01 — fluxos fundamentais (2026-07-16)

Status: implementado e validado em PostgreSQL/Docker.

- `PmocPlan` e `Operation` receberam `serviceTypes OperationType[]`; o tipo principal continua em
  `defaultOperationType`/`type` para retrocompatibilidade. Não foi criado enum paralelo.
- A seleção oficial continua em `PmocPlanEquipment`. Na edição, `equipmentIds` substitui a
  cobertura e o primeiro item sincroniza o campo principal legado.
- A cadeia `PmocPlan → ExecutionRequest → Operation → Assignment → MaintenanceExecution` preserva
  equipamentos em `inspectedEquipments` e tipos em `serviceTypes`.
- `DocumentContextService` resolve `signatureOverrideId` somente para PMOC. Builder e Renderer
  continuam sem acesso a banco ou Storage.
- O Template é autoritativo: `NONE`/`FIXED` ignoram assinatura de execução; `COLLECTED` coleta a
  execução; `HYBRID` combina institucional e execução.
- Migration aditiva `20260716210000_pmoc_ux01_service_types`, com backfill pelos tipos principais.
- Nenhum endpoint, renderer, wizard, scheduler, documento ou domínio paralelo foi criado.

## FIELD REPORT HANDOFF 01 — 2026-07-17

- `OperationDocument` passou a representar também o estado editorial `DRAFT | PENDING | READY |
  STALE`, sem confundi-lo com o estado do artefato PDF. `DocumentRevision` preserva alterações em
  histórico append-only.
- O fluxo oficial é `Operation → Assignment → MaintenanceExecution → DocumentContext → Builder →
  Blueprint → Renderer → PdfEngine → Storage → /documentos`; não foi criado pipeline paralelo.
- Operator prepara `WORK_ORDER`, `TECHNICAL_REPORT`, `TECHNICAL_OPINION`, `BUDGET` e `PMOC` somente
  quando possui o Assignment. `RECEIPT` permanece fora da coleta mobile. Render/finalização são
  exclusivos de OWNER/MANAGER.
- A assinatura do cliente é obrigatória para OS, visita, orçamento e PMOC; Laudo e Recibo recebem
  apenas assinatura técnica. Imagens ficam no Storage e respostas comuns expõem só metadados.
- Assinaturas técnicas agora pertencem à organização, aceitam profissão/registro/ordem/default e
  são copiadas para snapshot imutável ao finalizar. O legado `SignatureMode` continua disponível
  para documentos históricos; o novo handoff usa a matriz oficial por tipo.
- Inbox de revisão, evidências, assinaturas reais, complementação técnica, finalização e Viewer
  oficial foram integrados à Central de Relatórios. `/documentos` exibe estado editorial e revisão.
- Migration aditiva: `20260717150000_field_report_handoff_01`; backfill marca documentos já
  renderizados como READY e associa assinaturas existentes à organização única da instalação.
- Runtime certificado para OS, Visita, Laudo, Orçamento, PMOC e compatibilidade de Recibo. PMOC
  preservou 2 equipamentos, 4 evidências, duas assinaturas e a cadeia oficial.

## PMOC FIX-01 — emissão oficial do PDF (2026-07-17)

- A emissão continua exclusivamente em `DocumentEngineService`; nenhum endpoint, renderer, engine,
  storage, entidade ou migration foi criado.
- As consultas de execução PMOC identificam explicitamente o documento `PMOC` mais recente e
  retornam metadados seguros de artefato (`renderedAt`, `fileSize`, `revision`, `renderMetadata`).
- O fingerprint passou a neutralizar a data/hora de emissão gerada pelo próprio Builder, inclusive
  quando impressa em seções/rodapé. O tempo não causa falso STALE; alterações documentais reais
  continuam exigindo nova renderização.
- Runtime real aprovado: PMOC-000048, documento `739340b6-7ee2-4fbf-8a9a-1b2ed3c4e6f3`, versão 4,
  PDF de 23.925 bytes, Preview/PDF com o mesmo fingerprint, catálogo confirmado e STALE após troca
  do responsável técnico.
# PMOC FIX-02A — revisão de assinaturas no Wizard (2026-07-17)

- O handoff documental passou a devolver, dentro de `customerSignature`, o usuário que realizou a coleta (`collectedBy`: id, nome e role).
- A substituição de assinatura atualiza `collectedById`, preserva revisões append-only e mantém auditoria `DOCUMENT_REVIEW_UPDATED`.
- Reabrir/salvar o rascunho não substitui mais silenciosamente o coletor de uma assinatura já existente.
- Nenhuma entidade ou migration foi criada; o fluxo reutiliza `OperationDocument`, `DocumentRevision`, `AuditLog` e o Document Engine oficial.

## PMOC FIX-02B — evidências fotográficas no Wizard (2026-07-17)

- O Wizard PMOC oficial ganhou a etapa **Evidências**, compartilhada pelos fluxos vindos do Operator e criados na Platform.
- `OperationPhoto` continua sendo a única entidade. A migration aditiva `20260717210000_pmoc_fix02b_photo_author` acrescenta autoria opcional, com backfill pelo operador e preservação por `SET NULL`.
- Upload múltiplo reutiliza `PATCH /operations/:id`; legenda e remoção atuam sobre a mesma foto, com auditoria e invalidação PENDING/STALE.
- `DocumentContext` continua sendo a única fonte da galeria; ordem e legendas foram certificadas no Wizard, Preview, render e PDF.

## Operator — início autônomo e retorno para revisão (2026-07-18)

- `Operation.requestedDocumentType` identifica o documento solicitado sem substituir `Operation`, `Assignment` ou `OperationDocument`.
- Migration aditiva `20260718110000_operator_attendance_workflow`; PMOCs existentes são retropreenchidos como `PMOC`, demais registros preservam `WORK_ORDER`.
- Atendimento iniciado pelo próprio OPERATOR cria Assignment próprio, percorre aceitar/iniciar/concluir e envia o handoff como `DRAFT` para aprovação.
- Atendimento delegado por OWNER/MANAGER retorna do campo como `PENDING`, projetado no contrato como `workflowStatus: REVIEW`, até finalização da gestão.
- Geração PMOC pelo Operator reutiliza uma `PmocExecutionRequest` pendente; solicitações reservadas a outro operador são rejeitadas.
- A publicação de conclusão de Operation deixou de ocorrer em criações/edições não concluídas; Lifecycle e Maintenance só sincronizam na transição real para `COMPLETED`.

## Production-only bootstrap (2026-07-18)

- Removidos o dataset demo, suas factories/constantes, o módulo `internal-demo`, os endpoints de
  dataset/reset e as flags `ENABLE_DEMO_DATA`/`ENABLE_DEMO_ENDPOINTS`.
- O seed principal deixou de criar organização fictícia, templates, catálogos, fornecedores,
  produtos, estoque, pricing, budgets, financeiro, procurement e quaisquer usuários de exemplo.
- `npm run prisma:seed` agora executa somente o bootstrap idempotente do primeiro OWNER usando
  `OWNER_EMAIL`, `OWNER_USERNAME`, `OWNER_NAME` e `OWNER_PASSWORD`.
- O bootstrap recusa criar um OWNER adicional quando o banco já possui outros usuários, não redefine
  credenciais em reexecuções e nunca registra senha/hash em logs.
- O OWNER recebe preferências, permissões integrais e `mustChangePassword=true`; os demais usuários
  devem ser criados pelo fluxo oficial de gestão de equipe após o primeiro acesso.
- Nenhuma migration foi necessária: a alteração remove somente código e dados de inicialização.
## DC-06 — certificação do Orçamento (2026-07-18)

- A origem por OS é aceita somente quando a Operation está `COMPLETED`; chamadas diretas com OS aberta retornam `409 BUDGET_OPERATION_NOT_COMPLETED`.

- Budget persiste emissão, introdução, subtotais de serviços/materiais, valor por extenso, validade, formas de pagamento e observações comerciais.
- BudgetItem diferencia SERVICE e MATERIAL, aceita item independente de Product, preserva valor unitário e ordenação; snapshots legados continuam compatíveis.
- Migration aditiva: 20260718190000_dc06_budget_certification, com backfill e sem perda de histórico.
- Cada Budget recebe OperationDocument próprio; Budget.operationId mantém apenas a origem comercial opcional e não disputa a unicidade documental da OS.
- Preview, render e download usam o mesmo BudgetContext → DocumentBuilder → Blueprint → LayoutEngine → Renderer → PdfEngine.
- Assinaturas do cliente e técnica reutilizam o handoff oficial; Budget e frontend não acessam Storage nem geram PDF.

## ORBIT_OPERATION_AUDIT_V1 — auditoria operacional (2026-07-18)

- Auditoria sem alteração funcional registrada em `docs/release/ORBIT_OPERATION_AUDIT_V1.md`.
- Veredito: `ORBIT_OPERATION_AUDIT_V1_NOT_READY`.
- Bloqueadores confirmados: bypass da máquina Operation/Assignment, escopo insuficiente para OPERATOR, submissão PWA não atômica, caminhos documentais comerciais paralelos, ausência de binário histórico por revisão, política de assinatura divergente no handoff, exposição de assets em JSON, lacunas de integridade relacional e truncamentos em consultas de produção.
- Validações aprovadas: Prisma, lint/build, 80 testes unitários, 12 testes PostgreSQL de integração, 24 de concorrência e 50 de segurança.
- Nenhuma migration ou regra de negócio foi criada nesta auditoria.

## Fluxo de revisão de Operações (execução em campo · 2026-07-19)

- `OperationStatus` ganhou `PENDING` e `REVIEW` (migration `20260719140000_operation_review_flow`, `ALTER TYPE ... ADD VALUE`).
- Ciclo sincronizado com o Assignment: atribuir (create/reassign) → operação `PENDING`; operador inicia (`PATCH /assignments/:id/start`) → `IN_PROGRESS`; operador conclui (`/complete`) → **`REVIEW`** (com `completedAt`; side-effects de conclusão adiados para a aprovação).
- Aprovação do responsável técnico: `PATCH /operations/:id/approve` (OWNER/MANAGER) → `REVIEW` → `COMPLETED` + `publishOperationCompletedTx` + `syncOperationCompletedTx` (PMOC) + audit `OPERATION_APPROVED`. Erro `OPERATION_INVALID_TRANSITION` (409) fora de `REVIEW`.
- `GET /operations/stats` inclui `PENDING`/`REVIEW` em `byStatus`; list-exports usa os novos rótulos (Pendente/Revisão).

## Assinaturas nos relatórios + revisão documental (2026-07-19)

- **Assinaturas ao final dos modelos**: todos os modelos exibem, no preview e no PDF, a assinatura coletada do cliente (coluna esquerda) e a do responsável técnico (coluna direita) — exceto Recibo e Laudo Técnico, que mantêm apenas a institucional. Renderer (`signatureComponentBlock`) passou a diagramar em pares lado a lado; `resolveHandoffSignatures` inclui REPORT/QUOTE no conjunto com assinatura do cliente.
- **Identificação**: OS, Relatório de Visita e PMOC passam a exibir o **Responsável técnico** = assinatura institucional selecionada na revisão (`technicalResponsibleName/Title`); o operador que coletou os dados aparece como "Operador em campo" (OS) e em "Local da visita" (Visita).
- **Bloqueio de PDF** ("Finalize a revisão antes de gerar o PDF oficial"): causa era handoff enviado sem revisão finalizada (`editorialStatus !== READY`), mesmo com a operação concluída. O fluxo de finalização (startReview → selectTechnicalSignature → finalize) agora é exposto no drawer da operação na Platform.

## Curadoria de notificações (2026-07-19)

- **Um evento completo por acontecimento**: removidas as notificações de passo — "Operação iniciada" (gestores) e `DOCUMENT_SUBMITTED` (gestores, duplicava a conclusão). A conclusão de campo notifica uma única vez: **"Atendimento aguardando revisão"** (`OPERATION_COMPLETED`).
- **Novo evento**: `ASSIGNMENT_REJECTED` — "Atendimento recusado" para a gestão, com o motivo (migration `20260719190000_notification_rejected_type`).
- **Deep links reais**: notificações de operação usam `/operacoes?operationId=<uuid>` (whitelist validada por regex) — o clique abre o drawer da operação; destinatário operador cai em `/operator/services`. "Atividade em atraso" escolhe a URL pelo destinatário.
- Mantidos: nova atribuição (operador), atraso, orçamento aprovado/rejeitado, PMOC (gerado/falha/manual), relatório revisado (operador).

## Sessões persistentes com refresh seguro (2026-07-19)

- **Graça de rotação** no `POST /auth/refresh`: reapresentar um refresh token rotacionado há ≤60s (corrida entre abas) devolve 401 simples, sem revogar a família; reuso fora da graça continua revogando todas as sessões (detecção de vazamento preservada). Rotação single-use, hash de token e revogação em logout permanecem intactos.
- **TTL**: `JWT_ACCESS_EXPIRES_IN_SECONDS` recomendado em 1800 (30 min) — a permanência real da sessão vem do refresh de 30 dias com rotação, não de access longo (AppSec preservado).

## ORBIT_CATALOG_SEED_HVAC — catálogo técnico padrão HVAC (2026-07-19)

- Migration aditiva e idempotente `20260719200000_orbit_catalog_seed_hvac`: popula, para todas as organizações, o Catálogo Técnico do segmento Refrigeração/Climatização — Checklist (Elétrica/Mecânica/Sistema Frigorífico/Limpeza/Drenagem/Segurança/Operação), Objetivos, Condições Observadas, Conclusões, Recomendações e Escopos de Plano.
- Cada item traz áreas por disciplina, tags coerentes e workflows (Geral por padrão; PMOC/MANUTENÇÃO nos escopos de plano). Escopos de plano carregam a periodicidade (Mensal→Anual, Corretiva) + Instalação/Desinstalação. Checklist com periodicidade nula (aplicável a qualquer atendimento; aparece em todos os documentos via includeGeneral).
- Idempotência por `WHERE NOT EXISTS` em (org, type, LOWER(title), deleted_at IS NULL [, maintenance_type]); reexecução não duplica nem sobrescreve ajustes manuais. Não cria entidades/endpoints/regras. Validada por equivalência estrutural à migration `20260716223100` (Docker indisponível para dry-run neste ambiente).
- Integração com o fluxo real já concluída: wizard do operador e drawer de nova operação consomem CHECKLIST do catálogo; objetivos/condições/recomendações/conclusões e escopos usam `TechnicalCatalogSelector`. Removidos componentes mortos com mock (`new-service-sheet`/`new-service-button`).

## Assinatura do cliente no relatório: cargo + empresa (2026-07-19)

- No bloco de assinatura do cliente dos relatórios (preview e PDF), o rótulo do cargo/função passou a exibir também o nome do cliente/empresa ao lado — ex.: "Gerente | Empresa X". Composto em `DocumentContextService.composeClientSignerTitle(role, companyName)`, com o nome da empresa vindo de `operation.customer.tradeName ?? name` (e do budget nos orçamentos avulsos). Aplica-se a WORK_ORDER/TECHNICAL_REPORT/PMOC/REPORT/QUOTE/BUDGET; partes vazias são omitidas. Sem mudança de dados, regras ou renderer — só a composição do título. Testes de unidade (80) e tsc aprovados.

## PMOC → Operação: origem no drawer + guarda de adiantamento (2026-07-19)

- **Criar OS a partir de um PMOC nos dois ambientes**: o fluxo `POST /pmoc/execution-requests/:id/generate-work-order` (já existente) cria a OS com todos os dados do plano (checklist do catálogo, equipamentos, tipos de serviço), vincula a MaintenanceExecution (cobertura), avança a recorrência e incrementa `last_generated_execution_number`. O Operator já tinha o fluxo (wizard → PMOC); agora a **Platform** também: nova origem "A partir de um PMOC" no drawer de nova operação (plano → execução pendente → operador → gerar OS), abrindo a operação criada.
- **Guarda de adiantamento**: gerar uma execução prevista para mais de `EARLY_GENERATION_THRESHOLD_DAYS` (10) dias no futuro passou a exigir confirmação — sem `allowEarly`, retorna `PMOC_EXECUTION_TOO_EARLY` (409) com `daysEarly`/`scheduledFor`/`executionNumber`. Confirmado, registra no **histórico do PMOC** (`PmocHistoryAction.REQUEST_EARLY_GENERATION`, migration `20260719210000_pmoc_early_generation`) + auditoria (`PMOC_EXECUTION_REQUEST_EARLY`), garantindo controle na plataforma. Frontend (drawer e wizard) mostra badge "Adiantada" e confirma antes de reenviar com `allowEarly`.
- Validado: `prisma generate`, `tsc` (backend+frontend), `eslint`, 80 testes unit e `next build`.

## Fix: intervalo de datas em /documents e /documents/handoffs (2026-07-20)

- `GET /documents` e `GET /documents/handoffs` quebravam com 500 (`PrismaClientValidationError: Invalid Date`) quando `to` vinha como timestamp ISO completo (ex.: dashboard V2 → radar/comparativo), pois o serviço anexava `T23:59:59.999Z` assumindo data-only, gerando `...ZT23:59:59.999Z`. Novo util `shared/utils/date-range.util.ts` (`dateRangeFilter`) aceita data-only (vira fim do dia UTC) e ISO completo (usado como está), e omite limites inválidos. Aplicado nos dois serviços. tsc + 80 testes unit aprovados.
# Customer Workspace + Sales Foundation — 2026-07-22

- A gestão operacional passou a ser centrada em `Customer`: a página dedicada do cliente reúne visão geral, equipamentos, serviços e vendas.
- Criado o domínio `Sales` com `Sale`, `SaleItem`, `SaleHistory`, `SaleStatus` e snapshots imutáveis de preço/custo obtidos exclusivamente por `PricingService`.
- Garantia da venda é persistida por duração, início e término; datas são calculadas no backend.
- Recibos oficiais continuam sendo `Operation` + Document Engine. `Operation.sourceSaleId` apenas registra a venda de origem e o endpoint de prefill acelera o Wizard sem duplicar o documento.
- Migration aditiva: `20260722143000_add_sales_domain`.
- Endpoints: `GET/POST /sales`, `GET/PATCH/DELETE /sales/:id`, `PATCH /sales/:id/complete`, `GET /sales/:id/receipt-prefill`.
- RBAC: OWNER/MANAGER administram vendas; VIEWER consulta; OPERATOR não acessa o domínio comercial.
# Operator First Access Signature — 2026-07-22

- O primeiro acesso do Operator agora conclui senha definitiva e assinatura institucional no mesmo fluxo.
- `Signature.userId` cria vínculo opcional e único com `User`; não existe entidade ou storage paralelo.
- A assinatura do operador é ativa, usa o mesmo `DocumentAssetResolver` e aparece automaticamente em `GET /signatures` e nos seletores técnicos dos relatórios.
- Endpoint multipart criado: `POST /api/v1/users/complete-first-access`.
- Migration aditiva: `20260722190000_user_institutional_signature`.
# Classificação comercial de produtos — 2026-07-22

- `Product` permanece como catálogo técnico único e recebeu as classificações independentes `isPurchasable` e `isSellable`.
- Produtos legados permanecem compatíveis: a migration aditiva classifica os registros existentes como compráveis e vendáveis.
- Um produto pode participar dos dois fluxos, mas não pode ficar sem finalidade comercial.
- `GET /api/v1/products` aceita os filtros `purchasable` e `sellable`.
- `SalesService` aceita somente produtos vendáveis; `ProcurementService` e os seletores de materiais aceitam somente produtos compráveis.
- A Platform separa o catálogo nas abas Produtos comprados e Produtos vendidos. Cliente > Vendas consome exclusivamente `sellable=true`.
- Migration: `20260722230000_product_commercial_classification`.
# Refinamento do cadastro de produtos — 2026-07-22

- Conflitos de SKU/código interno agora retornam mensagem oficial em pt-BR.
- O cadastro visual pode criar o preço inicial após o produto, mas os valores continuam pertencendo exclusivamente ao Pricing Domain.
- Nenhum campo monetário foi adicionado a `Product` e nenhuma migration foi necessária neste refinamento.
# Estoque simplificado e disponibilidade para venda — 2026-07-22

- O formulário de estoque foi reorganizado sem alterar o domínio: saldo físico continua derivado exclusivamente de movimentos e disponível continua sendo saldo físico menos quantidade separada.
- A listagem de Pricing passou a expor `product.isSellable` para consumidores autorizados filtrarem produtos comerciais sem consulta adicional.
- Novos preços criados no formulário de produto iniciam vigência às 00:00 UTC do dia, evitando indisponibilidade artificial em vendas registradas no mesmo dia.
- Mensagens de produto inativo/não vendável em Sales foram localizadas para pt-BR.
- Nenhuma migration foi necessária.

# Paridade do Wizard mobile de OS e assinatura no PDF — 2026-07-22

- O Operator passou a persistir os mesmos campos editoriais da criação de OS na Platform: solicitação/defeito, serviços executados e resultado/observações, além de cliente, local, múltiplos equipamentos, tipo, checklist e evidências.
- A coleta no mobile possui etapa própria e obrigatória com assinatura, nome e função/vínculo do cliente ou responsável. O mesmo instante ISO é persistido em `Operation.signedAt` e no snapshot oficial do handoff.
- A criação autônoma de OS/RVT por `OPERATOR` rejeita payload sem assinatura ou identificação; a conclusão de Assignment desses documentos também verifica assinatura, nome e data antes da transição.
- O Renderer oficial reserva uma linha exclusiva para `Assinado em`, preservando data e hora no PDF em vez de truncá-las junto ao cargo/legenda.
- Sem migration ou entidade nova. Builds backend/frontend e 86 testes backend aprovados; a suíte focada do Document Engine possui 36 casos.

## Correções complementares de OS/RVT

- `OperationStatus` não é mais inserido cru no Blueprint: Rascunho, Pendente, Em andamento, Em revisão, Concluída e Cancelada são os rótulos oficiais em pt-BR.
- A correção é feita no Builder e vale igualmente para Preview e PDF; teste focado garante `COMPLETED` → `Concluída` na identificação da OS.
- Os fluxos autônomo e atribuído de OS/RVT apresentam o resumo operacional junto da coleta da assinatura. A confirmação informa conclusão e geração do PDF, sem revisão da gestão para esses dois tipos.

# Assinatura técnica própria do Operator em OS/RVT — 2026-07-22

- Reutilizado o vínculo oficial `Signature.userId`: cada Operator mantém uma única assinatura institucional própria, sem entidade ou storage paralelo.
- Endpoints próprios: `GET /signatures/me`, `POST /signatures/me` (multipart) e `GET /signatures/me/download`.
- Ao preparar OS/RVT, o handoff usa a assinatura ativa vinculada ao operador como padrão e não utiliza mais a assinatura institucional principal da organização.
- `PATCH /documents/:id/handoff/technical-signature` aceita Operator somente em OS/RVT sob sua responsabilidade e somente quando `signature.userId === actor.id`.
- A finalização cria o snapshot imutável da assinatura selecionada com origem `OPERATOR`; documentos antigos e demais tipos documentais permanecem inalterados.
- Nenhuma migration: `Signature.userId` e `OperationDocument.technicalSignatureId` já existiam.
## Correção de integração — checklist da OS autônoma no Operator (2026-07-22)

- Nenhuma entidade, migration ou endpoint foi alterado.
- `POST /api/v1/operations` continua recebendo o snapshot oficial `{ label, done, note? }`.
- O Operator voltou a permitir seleção opcional no catálogo; itens escolhidos no atendimento autônomo chegam como `done: true`.
- O identificador interno do catálogo permanece no frontend e não atravessa a validação `forbidNonWhitelisted`.
## Docker build — dependências de produção sem instalação duplicada (2026-07-22)

- A imagem da API passou a instalar o lockfile uma única vez no estágio `dependencies`.
- O estágio `production-dependencies` executa apenas `npm prune --omit=dev`; o runtime copia esse resultado e não acessa o registry npm.
- O cache BuildKit em `/root/.npm` reduz downloads em reconstruções, mantendo `npm ci` e o lockfile como fontes determinísticas.
- Build da imagem e verificação interna de NestJS, Prisma Client e Prisma CLI aprovados.
## Catálogo exclusivo de checklist do RVT (2026-07-23)

- `TechnicalCatalog` permanece como fonte única, sem nova entidade ou endpoint paralelo.
- Itens do RVT são classificados por `type=CHECKLIST`, workflow exclusivo
  `TECHNICAL_REPORT` e periodicidade `WEEKLY` ou `SEMIANNUAL`.
- Itens operacionais de OS/PMOC permanecem classificados nos workflows `WORK_ORDER`/`PMOC`.
- `GET /technical-catalogs` ganhou o filtro aditivo `workflowsAny` para consultas OR entre
  workflows, preservando `workflow` e `includeGeneral`.
- Migration `20260723123000_rvt_checklist_catalog_defaults`: 11 itens Semanais e 7 Semestrais,
  editáveis e soft-deletáveis.
- O bootstrap de produção replica os mesmos defaults para instalações novas nas quais a
  Organization é criada depois do migrate; reexecução não duplica nem restaura itens removidos.

# PMOC — execução individual por equipamento (Passo 2) — 2026-07-27

- `PmocExecutionRequest` passou a possuir `equipmentId` obrigatório. A migration aditiva
  `20260727190000_pmoc_execution_per_equipment` vincula registros anteriores ao equipamento
  primário do plano sem remover histórico.
- A unicidade agora é `pmocPlanId + equipmentId + scheduledFor`; equipamentos diferentes podem
  ser executados na mesma data e a numeração monotônica global do PMOC é preservada.
- Prefill, Operation, evidências e documento projetam exatamente um equipamento coberto.
- A geração aceita no máximo seis evidências e continua sem mínimo obrigatório.
- `POST /pmoc/:id/execution-requests` aceita `equipmentId?`; a omissão usa o equipamento primário
  para retrocompatibilidade.
# Coleta de equipamentos em OS atribuída — 2026-08-03

- Adicionado `POST /api/v1/operations/:id/equipments` para o Operator registrar, durante uma
  execução atribuída, equipamentos que não foram definidos pela gestão.
- O fluxo aceita vincular equipamentos ativos já cadastrados para o cliente e cadastrar vários
  equipamentos encontrados em campo.
- Cadastro, QR Code, vínculo principal, snapshots de `OperationInspectedEquipment`, revisão
  documental e auditoria são persistidos em uma transação serializável protegida por advisory lock.
- A operação precisa estar `IN_PROGRESS` e sem qualquer equipamento previamente vinculado.
- Nenhuma entidade ou migration foi criada.

## RVT — correção de conclusão e acionamento (2026-08-03)

- O payload de conclusão agora projeta apenas os campos graváveis de `maintenanceChecklist`; campos
  de leitura retornados pela API não atravessam o `ValidationPipe` com `forbidNonWhitelisted`.
- A validação estrita do backend foi preservada; não houve alteração de entidade, migration ou contrato.
- A Platform mantém ações distintas para gerenciar a atribuição e executar o RVT no wizard de campo.
- Execuções RVT operacionais agora garantem uma Assignment primária na mesma transação da Operation.
- Registros preparados anteriormente sem Assignment são reparados idempotentemente no próximo `prepare`.
- `OperationDetail` projeta oficialmente `assignment` a partir da atribuição primária.

## RVT — consolidação da execução Platform/Operator (2026-08-03)

- Checklists configurados nascem executados (`YES`) e podem ser desmarcados em campo.
- A assinatura do responsável técnico é projetada na Operation e preservada no Handoff; o Operator
  não tenta reassociá-la como assinatura pessoal.
- `PATCH /operations/:id` sincroniza até dez `auxiliaryOperatorIds` em Assignments secundárias.
- Apenas a Assignment primária executa o RVT. Auxiliares são read-only e nunca substituem
  `Operation.operator` no documento.
- Mudanças de auxiliares não tornam o documento STALE.

## RVT — fechamento de checklist, assinatura e atribuição (2026-08-03)

- A preparação da execução persiste no snapshot da Operation os catálogos Semanal e Semestral; o
  tipo selecionado nasce marcado e o complementar permanece apenas informativo.
- O Builder sempre projeta os dois grupos no mesmo Blueprint e impede marcação no grupo não
  selecionado. Preview e PDF continuam compartilhando esse Blueprint.
- RVT sem assinatura efetivamente coletada não cria bloco pendente de cliente. A assinatura
  institucional do responsável técnico permanece no documento.
- `PATCH /assignments/:id/reassign` sincroniza responsável e `auxiliaryOperatorIds` na mesma
  transação. Não houve alteração de schema ou migration.
- No RVT planejado, o título/cabeçalho mantém o número documental (`RVT-000039`), enquanto o campo
  `Identificação do relatório > Número` usa a sequência da execução (`001`, `002`, ...).

## Orçamento — ordem semântica das condições especiais (2026-08-21)

- A descrição informada no passo `Dados gerais` do wizard (`budget.description`) é projetada em
  `budget-service-description`, com o título `Descrição do(s) serviço(s)`, logo após os serviços e
  antes das seções de materiais.
- Condições comerciais continuam no fim do corpo com validade, formas de pagamento e observações
  comerciais, sem repetir a descrição geral.
- Preview e PDF permanecem derivados do mesmo `DocumentBlueprint`.
