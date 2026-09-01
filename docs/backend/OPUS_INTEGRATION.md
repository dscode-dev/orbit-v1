# OPUS Frontend Integration

## Portal do Cliente e Chamados

- `/customer/login` possui sessão própria; APIs: `/customer/me`, `/customer/operations`,
  `/customer/equipments` e `/customer/tickets`.
- Operations/Chamados usam `{ items, pagination }`; estados de UX incluem senha temporária,
  loading, retry, vazio, chamado enviado e operação vinculada.
- Não criar mocks para PMOC/RVT: a projeção da Operation identifica as execuções.
- `/service-tickets` reutiliza `OperationCreationDrawer` na ação “Criar operação e delegar”.

## Compatibilidade das migrations recentes

- Nenhum endpoint foi removido.
- `source` mantém `MANUAL` como fallback de registros históricos.
- `referencePoint` permanece opcional.
- Não é necessário tratamento de indisponibilidade de dados antigos.

## Ajustes de endereço e calendário

- `CustomerAddress.referencePoint?: string | null` está disponível no CRUD oficial.
- O Operator deve mostrar `complement` e `referencePoint` no resumo do atendimento.
- Esses campos não pertencem ao documento final.
- Datas previstas/cobertura PMOC devem ser renderizadas como datas-calendário UTC.
- O status presente no Blueprint de orçamento já chega traduzido pelo backend.

## Refinamento de execução e orçamento

- PMOC por equipamento: consumir `lastExecutionNumber`, `lastExecutionDate`, `nextExecutionNumber`,
  `nextExecutionDate` e `executionStatus` da projeção oficial.
- Atendimentos Operator: a API retorna Operations mais recentes primeiro; concluídas permanecem no
  último grupo da interface.
- Budget: `source=CATALOG` identifica descrição sem preço; `source=MANUAL` identifica item
  comercial. Nunca inferir origem pelo texto ou por preço zero.

## Equipment/Budget catalogs

Use `technicalCatalogsApi.listEquipmentTypes()` para o campo Tipo do equipamento e
`technicalCatalogsApi.listBudgetMaterialDescriptions()` para o multi-select “Descrição dos
Materiais”. O primeiro persiste `equipmentTypeCatalogId`; o segundo apenas preenche snapshots do
`BudgetItem`.

Itens arquivados não aparecem em novas seleções. Equipamentos antigos mantêm o título relacionado.

## Operations — criação e execução em campo

`serviceValue` é informação operacional da Operation. OWNER/MANAGER informam na criação; o Operator
atribuído apenas visualiza no detalhe. Não renderize o campo em documentos.

O payload `inspectedEquipments[]` aceita `manufacturer`, `model` e `capacity`. Use-o no atendimento
para completar exclusivamente campos vazios dos equipamentos relacionados. A API rejeita IDs fora
do escopo da Operation. Listas devem exibir `Marca - Modelo - Capacidade` e o setor como subtítulo.

## PMOC — contrato visual de ciclos

O número visual é `equipmentExecutionNumber`, com sequência `001..plannedExecutionCount` por
equipamento. A aba Execuções usa `overview.equipmentExecutions`. O total configurado permanece em
`expectedExecutions`; o agregado operacional está em `expectedEquipmentExecutions`.

Não calcule finalização no frontend. `OVERDUE` e `COMPLETED` são decisões do backend.

## PMOC — cadastro de configuração

Na rota `/pmoc`, o Wizard oficial usa `POST /pmoc` com `configurationOnly: true`. O modo possui
quatro etapas: identificação/cobertura, planejamento, execuções e confirmação. A resposta não traz
execuções nem documento; não implemente fallback, criação de OS ou renderização após o sucesso.

Campos obrigatórios: cliente, endereço, equipamentos, escopos, tipos de serviço, periodicidade,
datas, OWNER técnico e assinatura vinculada ao mesmo OWNER.

## Cliente 360

Na aba Visão Geral, use `operationApi.getOperationStats({ customerId })` e uma lista limitada de
operações recentes. Contatos usam o CRUD aninhado oficial e confirmação antes da exclusão. Na aba
Serviços, `OperationCreationDrawer` recebe `initialValues.customerId` + `lockCustomer`; nunca crie
outro formulário de Operation.

## Declaração do Recibo por origem

- `SALE`: consumir `GET /sales/:id/receipt-prefill`, mostrar CPF/CNPJ e usar “venda de produtos”.
- `OPERATION` ou manual: usar “serviços prestados”.
- Nunca gerar a declaração com placeholder enquanto o cliente estiver carregando.
- Itens e observações chegam juntos em `description`; o usuário pode editar o texto final.
- Preview/PDF continuam consumindo o snapshot `receiptDeclaration` pelo Document Engine.

## OS originada em PMOC

`PmocOperationSource` apenas escolhe plano/execução e carrega o prefill. A revisão acontece no
`OperationCreationDrawer`; somente o último passo chama `generateWorkOrder`. Cliente/equipamentos
são readonly, enquanto operador, agenda, procedimentos e textos permanecem revisáveis. A API
preserva toda a cobertura e entrega ao Operator o checklist estruturado por equipamento. Não use
`operationApi.createOperation` nesse fluxo.

## Checklists RVT/PMOC

- RVT Platform e Operator usam os mesmos itens classificados como `WEEKLY` e `SEMIANNUAL`.
- Sempre renderize ambos os grupos; `maintenanceType` é o realizado.
- PMOC usa `checklistCatalogIds` + `includeChecklistInOperations`; a OS gerada já retorna o snapshot em `checklist`.
- `/maintenance-checklists?type=CHECKLIST` é o ponto administrativo único.

## Gestão de execuções por operador

A rota `/operator-executions` é uma projeção gerencial real de Assignment + Operation. Consumir `operatorExecutionsApi.list/get/operations`; não derivar métricas da página atual de Operations. Filtro de competência usa `YYYY-MM`, histórico e agenda são paginados e a navegação de uma linha reutiliza `OperationDetailDrawer`. O Orbit não calcula comissões.

## Operator — matriz de atendimento em campo

- Início autônomo: somente `WORK_ORDER` e `TECHNICAL_REPORT`.
- OS/RVT atribuídas pela gestão: também concluem diretamente, sem tela de aprovação.
- PMOC, Laudo, Orçamento e demais tipos: aparecem apenas quando atribuídos e preservam `REVIEW`.
- Depois de OS/RVT concluída, usar `POST /documents/:id/handoff/finalize`, `POST /documents/:id/render` e `GET /documents/:id/download`.
- Compartilhamento usa o arquivo retornado pelo download autenticado; nunca storage URL, Base64 persistente ou PDF local.

## PMOC — precondição de cobertura ativa

- Consultar `GET /pmoc/active-coverage?customerId={uuid}` após a escolha do cliente.
- Mostrar aviso não bloqueante com número, nome e fim da cobertura dos PMOCs retornados.
- Se o usuário confirmar, reenviar a criação com `confirmActiveCoverage: true`.
- Tratar o erro `409 PMOC_ACTIVE_COVERAGE_CONFIRMATION_REQUIRED` da mesma forma; a API continua sendo a autoridade contra bypass e condições de corrida.
- A confirmação não é exigida em alterações de PMOCs existentes.

## ORBIT_SECURITY_FIX01 — regra obrigatória para clientes web/PWA

`Assignment` é a única fonte de autorização do Operator. Consuma as listagens normalmente e nunca
envie ou aplique um filtro local baseado em `operation.operatorId`. A API pagina depois de aplicar o
ownership. Chamadas diretas a operação, foto, execução, documento, preview, download, Handoff,
histórico, lifecycle ou material não pertencente retornam `403 FORBIDDEN` sem dados parciais.

Ao receber 403, fechar viewers/drawers que dependam do recurso e recarregar a fila oficial. Não há
mudança nos tipos públicos nem endpoint novo.

## DC-05 — Recibo / Garantia

Exponha RECEIPT somente para OWNER/MANAGER. O Wizard possui origem manual ou OS `COMPLETED`, dados
editáveis, garantia, assinatura técnica e Preview. Envie os campos `receipt*` descritos em
`API_CONTRACTS.md`; não envie fotos nem assinatura do cliente. Use Handoff e DocumentViewer oficiais.


## PMOC — coleta consolidada

- Wizard e Operator exibem fotos persistidas da `Operation` e adicionam novas pelo contrato atual.
- Assinatura do cliente é lida/escrita pelo Handoff; `collectedBy` identifica o coletor real.
- Responsável técnico (`PmocPlan`) e assinatura institucional (`technicalSignature`) são conceitos
  distintos e devem aparecer em blocos separados.
- O override do PMOC tem precedência ao criar o Handoff. Não escolher assinatura localmente.

## PMOC UX-02.1 — contrato pronto para UI

- Política: `GET /documents/configuration/types/PMOC`; não usar fallback `NONE` durante loading/erro.
- Documento: `DocumentViewer` oficial recebe a Operation PMOC e oferece Preview → Render → Download.
- Download: resposta `application/pdf` binária; consumir com `api.blob()` e filename do header.
- Evidências: fotos oficiais vivem na Operation; mínimo 4 somente para concluir ou emitir PDF.
- Execution Request: `operation.signedAt`, `_count.photos`, `documents` e equipamentos inspecionados
  sustentam os badges sem regra documental local.
- Operator pode ler exclusivamente a configuração PMOC sanitizada. Nenhum `storageKey` é público.

## PMOC UX-02

- Nome: `GET /pmoc/name-suggestion?customerId=<uuid>`; omita `name` na criação se não personalizado.
- Escopo: consultar Catálogo com `type=PLAN_SCOPE` e enviar seleção em `scopeCatalogIds`.
- “Outros” é item oficial; valores novos usam o CRUD existente e ficam disponíveis após refetch.
- Data pontual: `PATCH /pmoc/execution-requests/:id/reschedule`; não alterar periodicidade nem criar
  request substituta no frontend.

## PMOC Foundation — Bloco 3

Não calcule métricas localmente. `PmocStats` fornece todos os cards, calendário e listas; cada
`PmocPlan.overview` fornece progresso e saúde. Use `indicator` diretamente:

| Indicator | UX |
| --- | --- |
| `ON_TIME` | Em dia |
| `DUE_SOON` | Próximo do vencimento |
| `OVERDUE` | Atrasado |
| `COMPLETED` | Concluído |
| `CANCELLED` | Cancelado |
| `FAILED` | Falha |

Navegação: `pmocPlanId → /pmoc/:id`, `operation.id → OperationDetailDrawer`, `document.id →
DocumentViewer`, `customer.id → /clientes/:id` e equipamentos para `/equipamentos/:id`.
`PmocHistoryItem.source` informa a origem append-only; não use metadata como HTML.

## PMOC Foundation — Bloco 2

| Fluxo | API/componente oficial |
| --- | --- |
| Criar plano | `pmocApi.create` via `PmocPlanWizard` |
| Gerar OS | `getExecutionRequestPrefill` → `OperationCreationDrawer` → `generateWorkOrder` |
| Reagendar | `rescheduleExecutionRequest(id, { scheduledFor, notes? })` |
| Cancelar | `cancelExecutionRequest` |
| Histórico | `getHistory`; não montar eventos localmente |
| Assinatura | `documentsApi.getConfiguration` + assinaturas cadastradas |

Use `plannedOperator/plannedTechnician` para a responsabilidade daquela execução. Defaults do
plano não substituem snapshots históricos. Na alteração dos defaults, a opção “aplicar às futuras
pendentes” mapeia para `applyDefaultsToPendingExecutions`; não aplique isso implicitamente.

Na Central de Relatórios, a ação PMOC navega para `/pmoc`. Não reative o formulário legado: o
relatório PMOC é consequência de Operation/Document Engine, enquanto o plano vive no domínio PMOC.

## PMOC Foundation 1.1

Use `executionNumber` como identidade (`001`, `002`, ...). O número da OS é somente
`execution.workOrderNumber`. Datas e metadata do scheduler são read-only. Retry/cancelamento
reutilizam o `executionRequest.id`; o frontend nunca reserva números.

## PMOC Foundation

Use `pmocApi.listExecutionRequests`, `createExecutionRequest`, `getExecutionRequestPrefill`,
`generateWorkOrder`, `cancelExecutionRequest` e `getHistory`. “Gerar Ordem de Serviço” abre o mesmo
`OperationCreationDrawer` usado por Operações/Agenda/OS. Não crie formulário alternativo nem ligue
MaintenanceExecution pelo frontend.

## DC-03.1 — campos adicionais do Laudo

| Campo UI            | Campo API                                |
| ------------------- | ---------------------------------------- |
| Responsável Técnico | `technicalOpinionResponsible`            |
| CREA/registro       | `technicalOpinionCrea`                   |
| Tipo de sistema     | `inspectedEquipments[].systemType`       |
| Local de instalação | `inspectedEquipments[].sector`           |
| Situação atual      | `inspectedEquipments[].currentSituation` |

Solicitante é hidratado integralmente pelo backend. Não replique razão social, documento ou
contatos no payload da Operation e não monte a tabela fora do `DocumentViewer`.

## DC-03 — TECHNICAL_OPINION

| Campo UI                   | Campo API                    |
| -------------------------- | ---------------------------- |
| Objetivo do Laudo          | `technicalOpinionObjective`  |
| Condições, uma por linha   | `technicalOpinionConditions` |
| Análise técnica            | `technicalOpinionAnalysis`   |
| Conclusão técnica          | `technicalOpinionConclusion` |
| Equipamentos e setor/local | `inspectedEquipments[]`      |

Não reutilize `reportedIssue`, `technicalDiagnosis`, `serviceDescription`, `observations`,
checklist ou fotos para montar o Laudo. Preserve a ordem recebida e use tabela fixa com quebra de
palavras. Responsável/CREA, dados do solicitante e assinaturas já chegam resolvidos; não acesse Storage nem interprete
`SignatureMode`.

## WORK_ORDER — QR textual

Na seção `equipment`, renderize `Código QR` como metadata comum. Novas Ordens de Serviço não trazem
componente `qrCode` nem imagem. Não crie fallback gráfico; o scanner permanece um fluxo separado.

## Refinamento TECHNICAL_REPORT — 14/07/2026

- Exiba o cabeçalho em duas linhas a partir de `header`: logo; depois título/número à esquerda e
  dados institucionais à direita.
- Preserve a ordem de `sections`. `technical-report-inspected-equipments` é a tabela
  `Equipamentos`, com uma ou várias linhas.
- Não espere nem recrie QR individual, materiais, fotos ou documentos relacionados nesse tipo.
- O checklist de manutenção recebido corresponde somente à periodicidade selecionada na Operation.

Apresentação documental: não mostrar `blueprint.version` no relatório. Renderizar apenas
`footer.content` no rodapé e manter a logo centralizada verticalmente com o bloco textual do header.

## DC-02 — Technical Report

`OperationDetail` agora inclui `technicalDiagnosis` e `technicalRecommendations`. A Central coleta:

| Campo UI               | Campo API                  |
| ---------------------- | -------------------------- |
| Objetivo da visita     | `reportedIssue`            |
| Diagnóstico/situação   | `technicalDiagnosis`       |
| Atividades executadas  | `serviceDescription`       |
| Recomendações técnicas | `technicalRecommendations` |
| Observações finais     | `observations`             |

Use somente `DocumentViewer` + endpoints oficiais de `TECHNICAL_REPORT`. O Blueprint entrega
parágrafos/listas, equipamentos e assinaturas já resolvidos. Não interpretar SignatureMode, não
gerar QR e não acessar Storage. `GET /documents?type=TECHNICAL_REPORT` confirma a emissão no
repositório.

## Product Backlog Closure 07

- `/reports`: Central de Relatórios e workflows reais.
- `/report-templates`: modelos, sem emissão.
- `/documentos`: repositório preservado.
- O wizard usa Operation, MaintenanceExecution para PMOC, configuração por tipo e o DocumentViewer oficial.
- Tipos: WORK_ORDER, TECHNICAL_REPORT, TECHNICAL_OPINION, PMOC e RECEIPT; BUDGET permanece em `/budgets`.

## Product Backlog Closure 05 — Reports and signature consistency

Use somente `DocumentViewer` para modelo, preview real, renderização e download.

Matriz de preview:

| Ação UI               | Endpoint                                               | Dados reais? |          Assinatura de execução? |
| --------------------- | ------------------------------------------------------ | -----------: | -------------------------------: |
| Visualizar modelo     | `GET /documents/templates/:templateId/preview`         |          Não |                              Não |
| Preview com Operation | `GET /documents/operations/:operationId/:type/preview` |          Sim |            Sim, quando aplicável |
| Renderizar documento  | `POST /documents/operations/:operationId/:type/render` |          Sim |            Sim, quando aplicável |
| Download              | `GET /documents/:documentId/download`                  |          Sim | Sim, mesmo blueprint renderizado |

Tipos que aceitam assinatura coletada da Operation:

- `WORK_ORDER`
- `TECHNICAL_REPORT`
- `REPORT`
- `RECEIPT`

O Opus não deve tentar interpretar base64 de assinatura fora do `SignatureComponent`. Renderize a
imagem somente quando `component.kind === "signature"` e `signature.image` existir.

## Product Backlog Closure 05.1 — Visit evidence workflow

`/reports/visita` deve ser tratado como workflow de evidências de uma Operation real.

Contrato de persistência:

- `PATCH /operations/:id`
- campos: `observations`, `checklist`, `photos[]`, `signatureData`, `signedAt`.

Contrato de preview/render:

- preview: `GET /documents/operations/:operationId/TECHNICAL_REPORT/preview`;
- render: `POST /documents/operations/:operationId/TECHNICAL_REPORT/render`;
- download: `GET /documents/:documentId/download`.

Fotos aparecem no blueprint como `component.kind === "image"` e, quando autorizadas/resolvidas pelo
backend, possuem `component.image.contentBase64`. Não usar object URLs como fonte documental.

## Sprint 21 — Performance notes for Opus

Nenhum endpoint de negócio foi alterado. O Opus deve continuar usando os contratos oficiais já
integrados.

Novos endpoints técnicos:

| Endpoint            | Uso                                                    |
| ------------------- | ------------------------------------------------------ |
| `GET /health/live`  | liveness de processo                                   |
| `GET /health/ready` | readiness com DB/storage                               |
| `GET /metrics`      | Prometheus text/plain para infraestrutura, não para UI |

Baseline medido localmente com fixture de performance:

- dashboard fan-out: p95 181.06 ms, 0% erro;
- inventory consumption: p95 58.39 ms, 0% erro;
- procurement receipt: p95 117.54 ms, 0% erro;
- financial settlement: p95 45.32 ms, 0% erro;
- document preview/render/download: p95 104.04 ms, 0% erro;
- operator read path: p95 28.31 ms, 0% erro.

Regras para manter esses números:

- usar paginação em todas as listas;
- não buscar páginas grandes por padrão;
- cancelar requisições obsoletas em busca/filtros;
- não montar documentos no frontend;
- manter `DocumentViewer` como componente único para preview/render/download;
- não criar polling agressivo sem debounce/backoff.

## Connection

Default development base URL:

```text
http://localhost:3000/api/v1
```

All responses use:

```ts
type ApiSuccess<T> = { success: true; data: T };
type ApiError = {
  success: false;
  error: { code: string; message: string; details: Record<string, unknown> };
};
```

Send `Authorization: Bearer <accessToken>` on protected calls. Capture `X-Request-Id` for support
logs.

## Authentication flow

1. `POST /auth/login`
2. persist access/refresh tokens securely;
3. `GET /users/me` for user, organization, permissions and preferences;
4. if `mustChangePassword=true`, show only the password-change screen;
5. use single-flight `POST /auth/refresh`;
6. clear tokens on refresh failure, `AUTH_SESSION_REVOKED` or `AUTH_USER_INACTIVE`.

Login payload:

```json
{
  "email": "<OWNER_EMAIL configurado no ambiente>",
  "password": "<OWNER_PASSWORD configurado no ambiente>"
}
```

## Endpoints ready for real integration

| Area         | Endpoints                                                             |
| ------------ | --------------------------------------------------------------------- |
| Auth         | login, refresh, logout, auth/me                                       |
| Profile      | users/me, change-password, preferences                                |
| Team         | users list/detail/create/update/disable/enable/delete/reset-password  |
| Avatar       | users/avatar upload/read/delete                                       |
| Organization | organization, settings, templates, branding assets                    |
| Health       | health                                                                |
| Customers    | customers CRUD/stats, addresses, contacts and attachments             |

Full production contracts remain in `API_CONTRACTS.md`.

## App bootstrap state

Use `GET /users/me`.

Important fields:

- `user.mustChangePassword`: hard navigation gate;
- `user.avatarAssetId`: optional;
- `role`: coarse navigation access;
- `permissions`: complementary feature flags;
- `preferences.theme`: `SYSTEM`, `LIGHT`, `DARK`;
- `organization.primaryColor` and `secondaryColor`: theme;
- `organization.segment`: opcional e configurado com os dados reais da instalação.

Optional fields:

- avatarAssetId;
- phone;
- jobTitle;
- organization.segment.

## Team pagination

```http
GET /users?page=1&limit=20&search=ricardo
```

Response data:

```ts
type UserPage = {
  items: TeamUser[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
};
```

Search covers name, email, username, phone and job title. Disabled users remain visible and have
`isActive=false`.

## Production-only bootstrap

Não existe bridge de demonstração. O bootstrap cria somente o primeiro OWNER configurado por
ambiente; todo usuário posterior deve ser criado pelos endpoints oficiais de equipe. Listagens sem
registros devem usar o estado vazio normal, sem arrays locais ou fallback de dados.

## UX states

- Loading: use skeletons, especially for dashboard and lists.
- Empty list: valid production state; never synthesize records.
- Disabled user: retain in list with status badge.
- Mandatory password: block normal shell and navigation.
- 401: attempt one refresh; on failure go to login.
- 403: show permission state, never silently retry.
- 409 `USER_CONFLICT`: field-level email/username feedback.
- 409 `USER_LAST_OWNER`: explain protected last OWNER.
- Upload errors: show 2 MiB avatar or 5 MiB branding limits.

## Pagination contract after Sprint 14.5

All paginated backend lists follow:

```ts
type Paginated<T> = {
  items: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number; // minimum 1
  };
};
```

Frontend notes:

- do not special-case `totalPages=0`; it should no longer happen;
- keep active filters while navigating pages;
- use `total === 0` for empty states;
- Asset Lifecycle may include additional `timelineGroups` next to `items` and `pagination`.

## Production data rule

All frontend modules must consume the official domain clients. Authentication, profile,
organization, team, customers, equipment, operations, documents, finance and procurement have no
mock or snapshot fallback. Empty API results are valid product states.

## Customer screens

### List

`GET /customers?page=1&limit=20&search=`. Debounce search by 250–400 ms. Search covers name,
tradeName, phones, email, CPF and CNPJ. Pagination is server-side.

Each row should show:

- name/tradeName;
- PERSON/COMPANY badge;
- CPF or CNPJ when present;
- phone/email fallback;
- active/inactive status;
- `_count` values where useful.

OWNER and MANAGER see “New customer” and edit actions. OPERATOR/VIEWER receive read-only UI.

### Registration form

Required: `type`, `name`.

Optional: tradeName, cpf, cnpj, email, phone, secondaryPhone, notes. Show CPF for PERSON and CNPJ +
tradeName for COMPANY, but do not make documents mandatory.

POST `/customers`; PATCH `/customers/:id`. Handle `CUSTOMER_CONFLICT` on CPF/CNPJ.

### Detail

`GET /customers/:id` returns customer, addresses, contacts and attachment metadata. Use tabs or
sections:

1. Overview;
2. Addresses;
3. Contacts;
4. Attachments.

Nested mutations:

- POST/PATCH/DELETE `/customers/:id/addresses[/addressId]`;
- POST/PATCH/DELETE `/customers/:id/contacts[/contactId]`.

Only one primary address/contact is retained by the backend.

### Status and delete

- PATCH `/customers/:id/disable`;
- PATCH `/customers/:id/enable`;
- DELETE `/customers/:id` — OWNER only, soft delete.

Do not remove a soft-deleted row from state automatically; refresh it and display inactive status.

### Attachments

Upload multipart `category` + `file` at `/customers/:id/attachments`. Maximum 5 MiB; PDF, PNG, JPG,
JPEG. Read `/customers/attachments/:attachmentId`, then build a data URL from MIME +
`contentBase64`. OWNER deletes; all roles may read.

### Stats

`GET /customers/stats` returns `total`, `active`, `inactive`, `people`, `companies`.

## Equipment screens

### List and cards

Use `GET /equipments` with server pagination, debounced search and optional customer/address/status/type
filters. Cards should show name, type, status, customer, address, tag, manufacturer/model and child/
attachment/metric counts.

Permissions: OWNER/MANAGER show create/edit/status controls; OPERATOR/VIEWER are read-only.

### Form

Required: customerId, type, name. Optional: addressId, parentEquipmentId, status, tag, manufacturer,
model, serialNumber, capacity, voltage, installation/warranty dates and observations.

After customer selection, load Customer detail and restrict address options to its addresses.
Parent options must come from Equipment list filtered by the same customer and must exclude the
current equipment.

### Hierarchy

Only direct parent and direct children exist. Do not build drag-and-drop trees or arbitrary depth
editing. Detail response contains `parent` and `children`.

### Status and stats

Statuses: ACTIVE, MAINTENANCE, INACTIVE, RETIRED. Use `/equipments/stats` for cards and `byType`.
Disable/soft delete keeps records visible; enable returns status to ACTIVE.

### Metrics

POST `{ key, value, unit, recordedAt? }` to `/equipments/:id/metrics`. OPERATOR is allowed to create.
GET returns newest first. OWNER/MANAGER may delete. Suggested UX: compact latest readings in detail
and a chronological chart/table.

### Attachments

Categories: PHOTO, MANUAL, WARRANTY, DOCUMENT. Upload multipart; read base64; OWNER/MANAGER delete.

### QR foundation

Display or generate a visual QR from `qrCode`. Store no QR image. `qrToken` and `qrCode` are stable
identifiers, not access credentials. Use `GET /equipments/lookup/:qrCode` to resolve scans.

## Equipment QR lookup

`GET /equipments/lookup/:qrCode` (todas as roles) resolve o equipamento pelo
identificador do QR (aceita `qrCode` ou `qrToken`) e retorna o mesmo payload de
`GET /equipments/:id`. O frontend lê o QR pela câmera (PWA, `@zxing/browser`) e
seleciona o equipamento automaticamente no wizard de atendimento. Erros:
`VALIDATION_ERROR` (400) e `EQUIPMENT_NOT_FOUND` (404).

## Templates: ativar/desativar

`DocumentTemplate` ganhou `isActive` (default `true`). `POST/PATCH /organization/templates`
aceitam `isActive`; o frontend usa para ativar/desativar modelos na tela de Relatórios (Modelos).
Migration: `20260627120000_template_is_active`.

## Operations (domínio operacional central)

`Operation` é o atendimento de campo — fundação única reutilizada por OS, PMOC,
Laudo, Relatório, Visita, Orçamento e Recibo (sem implementações paralelas). Toda
OS nasce de uma Operation; criar uma Operation gera automaticamente um
`OperationDocument` `WORK_ORDER` em `DRAFT` (`OS-000001`).

Endpoints: `GET /operations` (lista/filtros `customerId,equipmentId,operatorId,type,status,search`),
`GET /operations/stats`, `GET /operations/:id`, `GET /operations/photos/:photoId`
(base64), `POST /operations` (cria + OS rascunho; `operatorId` opcional para delegação por OWNER/MANAGER),
`PATCH /operations/:id`. Fotos como data URL (PNG/JPEG, máx. 16 × 5 MiB) e assinatura como data
URL (texto). O parser da rota suporta o volume agregado do contrato. Em
`413 UPLOAD_FILE_TOO_LARGE`, preserve o estado do formulário e peça redução/compressão das
evidências; não faça retry automático. O histórico de equipamento/cliente é derivado de
`/operations` por `equipmentId`/`customerId`. Migration:
`20260627150000_operation_domain_foundation`.

Ao criar Operation, `OWNER` e `MANAGER` podem enviar `operatorId` para delegar a
execução. Sem `operatorId`, o backend usa o próprio usuário autenticado.
`OPERATOR` nunca delega; se enviar `operatorId`, a API atribui ao próprio operador
após validação do UUID. O usuário delegado deve estar ativo, não desativado e ter
perfil operacional (`OWNER`, `MANAGER` ou `OPERATOR`). Erro:
`OPERATION_OPERATOR_INVALID`.

## Document Engine (Sprint 6)

O backend agora possui preview estruturado e render/download PDF oficial. Remover previews mocks
para documentos oficiais conforme as telas forem conectadas.

Endpoints:

```http
GET  /documents/operations/:operationId/:type/preview
POST /documents/operations/:operationId/:type/render
GET  /documents/templates/:templateId/preview
GET  /documents/:documentId/preview
POST /documents/:documentId/render
GET  /documents/:documentId/download
```

Tipos:

- `WORK_ORDER`
- `REPORT`
- `TECHNICAL_REPORT`
- `PMOC`
- `QUOTE` (somente OWNER)
- `RECEIPT` (somente OWNER)

Fluxo UX sugerido:

1. Na lista de documentos, usar `GET /operations` e os `documents[]` reais.
2. Ao abrir o preview, chamar `GET /documents/:documentId/preview`.
3. Se o usuário clicar "Gerar PDF", chamar `POST /documents/:documentId/render`.
4. Se `downloadReady=true`, chamar `GET /documents/:documentId/download`.
5. Converter `contentBase64` para `Blob` com `mimeType=application/pdf`.

Fluxo UX para Modelos de Documentos:

1. Listar templates com `GET /organization/templates`.
2. Ao clicar em "Visualizar modelo", chamar `GET /documents/templates/:templateId/preview`.
3. Renderizar o retorno no `DocumentViewer`.
4. Não criar Operation, não usar Demo Dataset e não usar preview local.

Estados:

- `DRAFT`: mostrar "Gerar PDF";
- `READY`: mostrar "Baixar PDF" e permitir "Gerar novamente";
- `DOCUMENT_DOWNLOAD_NOT_READY`: ainda não renderizado;
- `DOCUMENT_FORBIDDEN_TYPE`: esconder Orçamento/Recibo para MANAGER/OPERATOR/VIEWER;
- `DOCUMENT_SIZE_LIMIT_EXCEEDED`: o documento ficou grande demais;
- `DOCUMENT_RENDER_FAILED`: mostrar retry e incluir `X-Request-Id` no suporte.
- `TEMPLATE_NOT_FOUND`: modelo removido/inexistente;
- `TEMPLATE_INACTIVE`: modelo inativo;
- `SIGNATURE_NOT_FOUND`, `SIGNATURE_INACTIVE`, `SIGNATURE_IMAGE_REQUIRED`: configuração de assinatura inválida;
- `STORAGE_FILE_NOT_FOUND`: asset referenciado não existe no storage.

Blueprint:

O preview retorna `sections[]` com componentes reutilizáveis (`metadata`, `paragraph`, `table`,
`list`, `image`, `qrCode`, `checklist`, `signaturePlaceholder`, `observation`). O frontend pode
renderizar esses componentes em tela, mas o PDF oficial sempre vem do backend.

Observações de UX:

- fotos ainda aparecem como componentes/metadados seguros no PDF; embed binário inline não é parte
  da Sprint 6;
- assinatura é placeholder arquitetural (`none`, `fixed`, `collected`, `hybrid`), sem CRUD;
- QR Code do equipamento aparece como componente lógico e não autentica acesso.

Próximos endpoints previstos:

- versionamento de documentos;
- uso efetivo da configuração de assinatura no Builder;
- envio por e-mail/WhatsApp;
- editor visual de templates.

## Document Configuration & Signatures (Sprint 7)

A Sprint 7 é backend-only e prepara o domínio de assinatura/configuração. Não altera o render PDF
oficial ainda. O frontend pode remover mocks de configuração de assinatura e consumir estes dados
reais.

Enums:

```ts
type SignatureMode = 'NONE' | 'FIXED' | 'COLLECTED' | 'HYBRID';
type DocumentTemplateType =
  | 'QUOTE'
  | 'WORK_ORDER'
  | 'RECEIPT'
  | 'REPORT'
  | 'TECHNICAL_REPORT'
  | 'PMOC';
```

Campos novos em `DocumentTemplate`:

```ts
{
  requiresSignature: boolean;
  signatureMode: SignatureMode;
  signatureId: string | null;
}
```

Estados de assinatura por template:

- `NONE`: sem assinatura;
- `FIXED`: seleciona assinatura cadastrada;
- `COLLECTED`: assinatura será coletada em fluxo futuro;
- `HYBRID`: aceita assinatura cadastrada e futura coleta.

Endpoints disponíveis:

```http
GET /documents/configuration
GET /documents/configuration/types/:type
GET /documents/configuration/templates/:templateId

GET    /signatures?page=1&limit=20&search=&active=true
GET    /signatures/:id
POST   /signatures
PATCH  /signatures/:id
DELETE /signatures/:id
POST   /signatures/:id/upload
GET    /signatures/:id/download
```

Paginação de assinaturas:

```ts
{
  items: Signature[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
}
```

UX sugerida:

- Em Configurações → Documentos, carregar `GET /documents/configuration`.
- Para escolher assinatura fixa/híbrida, listar `GET /signatures?active=true`.
- Mostrar upload apenas para OWNER.
- Para preview de imagem, chamar `GET /signatures/:id/download` e montar `Blob` a partir de
  `contentBase64`.
- Ocultar toda a área para OPERATOR.

Mocks que podem ser removidos:

- lista local de assinaturas;
- estados locais de assinatura por template;
- imagem de assinatura fixa mockada.

## Document Signature Integration (Sprint 8)

O Builder agora usa a configuração de assinatura no PDF oficial. O frontend deve continuar usando os
mesmos endpoints de preview/render/download; contratos de rota não mudaram.

Novo componente possível no Blueprint:

```ts
type SignatureComponent = {
  id: string;
  kind: 'signature';
  mode: 'NONE' | 'FIXED' | 'COLLECTED' | 'HYBRID';
  keepTogether?: boolean;
  signatures: Array<{
    role: 'fixed' | 'collected';
    label: string;
    name: string | null;
    title: string | null;
    signedAt: string | null;
    caption: string | null;
    image?: { mimeType: string; fileSize: number; contentBase64: string } | null;
  }>;
};
```

UX:

- se `kind='signature'`, renderize bloco não quebrável;
- `fixed` pode exibir a imagem no preview;
- `collected` deve exibir linha manual;
- o PDF baixado já vem com assinatura fixa quando configurada;
- erros possíveis ao renderizar: `SIGNATURE_NOT_FOUND`, `SIGNATURE_INACTIVE`,
  `SIGNATURE_IMAGE_REQUIRED`, `DOCUMENT_RENDER_FAILED`.

Mocks que podem ser removidos:

- placeholder local de assinatura fixa no PDF;
- regra local de qual assinatura aparece por tipo;
- geração local de área de assinatura.

## Asset Lifecycle / Timeline oficial do ativo (Sprint 9)

Use estes endpoints para a linha do tempo de equipamentos. Não derive histórico combinando
`/operations`, documentos e anexos no frontend.

Endpoints disponíveis:

```http
GET  /asset-lifecycle
GET  /asset-lifecycle/:id
POST /asset-lifecycle
GET  /equipments/:id/lifecycle
GET  /equipments/:id/lifecycle/stats
GET  /asset-lifecycle/:id/attachments
POST /asset-lifecycle/:id/attachments
DELETE /asset-lifecycle/:id/attachments/:attachmentId
```

Paginação:

```ts
{
  items: AssetLifecycleEvent[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
}
```

Filtros:

- `page`;
- `limit`;
- `customerId` (`GET /asset-lifecycle`);
- `equipmentId`;
- `operationId`;
- `type`;
- `performedBy`;
- `from`;
- `to`.

Para tela de equipamento, prefira:

```http
GET /equipments/:id/lifecycle?page=1&limit=20&type=&performedBy=&from=&to=
```

Campos importantes:

- `timeline`: card pronto para UI, preferir este objeto na renderização;
- `type`: badge/ícone do evento;
- `occurredAt`: data operacional do evento;
- `createdAt`: data em que o registro foi gravado;
- `performedBy`/`performer`: técnico/usuário relacionado;
- `operation`: link para atendimento;
- `document`: link para documento;
- `attachments`: anexos ativos do evento;
- `metadata`: não faz parte do payload público após a Sprint 20.5; use `timeline.references` e os
  campos explícitos do evento.

Campos que o frontend não deve esperar em Asset Lifecycle:

- `storageKey`;
- `eventId` e `deletedAt` em anexos;
- e-mail do performer;
- valores financeiros, credenciais, tokens ou binários em metadata.

Downloads e exclusões de anexos devem sempre passar pelos endpoints oficiais autorizados.

Sprint 9.5:

O backend agora entrega o objeto `timeline` em cada evento e `timelineGroups` nas listagens. O Opus
não precisa mais mapear enum para ícone/cor/título.

Use:

```ts
event.timeline.icon;
event.timeline.color;
event.timeline.title;
event.timeline.subtitle;
event.timeline.category;
event.timeline.references;
event.timeline.attachments;
```

Para infinite scroll:

- continue paginando com `page`/`limit`;
- use `timeline.sortKey` como chave estável visual;
- use `timeline.groupKey` ou `timelineGroups[].date` para separar por dia;
- ao mudar filtros, reinicie a paginação.

Para tela de cliente:

```http
GET /asset-lifecycle?customerId=<customerId>&page=1&limit=20
```

Para tela de equipamento:

```http
GET /equipments/:id/lifecycle?page=1&limit=20
```

Tipos e sugestão visual:

- `INSTALLATION`: instalação / início do ativo;
- `INSPECTION`: inspeção;
- `PREVENTIVE`: preventiva;
- `CORRECTIVE`: corretiva;
- `MAINTENANCE`: manutenção geral;
- `PART_REPLACEMENT`: peça trocada;
- `WARRANTY`: garantia;
- `DOCUMENT`: documento gerado;
- `NOTE`: observação;
- `CUSTOM`: evento especial.

Estatísticas:

```http
GET /equipments/:id/lifecycle/stats
```

Retorna:

- `preventiveCount`;
- `correctiveCount`;
- `documentCount`;
- `inspectionCount`;
- `firstInstallation`;
- `lastMaintenance`;
- `meanDaysBetweenInterventions`;
- `byType` com todos os tipos oficiais.

Upload de anexos:

```ts
const form = new FormData();
form.append('file', file);
form.append('category', 'PHOTO');
await api.post(`/asset-lifecycle/${eventId}/attachments`, form);
```

Aceito:

- PDF;
- PNG;
- JPG/JPEG;
- 5 MiB.

RBAC para UX:

- OWNER/MANAGER/OPERATOR/VIEWER: podem ver;
- OWNER/MANAGER/OPERATOR: podem criar evento e anexar arquivo;
- OWNER/MANAGER: podem remover anexo;
- nenhum papel edita ou exclui evento.

Integrações automáticas:

- concluir Operation cria evento no ativo;
- renderizar documento cria evento `DOCUMENT`;
- depois dessas ações, invalide a query de lifecycle do equipamento.

Metadata confiável para navegação:

- eventos de Operation carregam `operationId`, `operationNumber`, `operationType`,
  `operationStatus`;
- eventos `DOCUMENT` carregam `documentId`, `documentType`, `documentNumber`, `renderStatus`,
  `renderedAt`;
- para UI, prefira `timeline.references.operation` e `timeline.references.document`, pois já vêm
  normalizados.

Mocks que podem ser removidos:

- timeline local de equipamento;
- contadores locais de preventiva/corretiva/documentos;
- histórico derivado manualmente de `/operations`;
- anexos temporários de evento.
- mapeamento local de enum para cor/ícone/título.

Próximos endpoints previstos:

- alertas de garantia/SLA;
- manutenção recorrente;
- PMOC;
- agenda automática;
- indicadores agregados globais.

## Maintenance Planning — Sprint 10

O Opus já pode integrar a fundação de planejamento de manutenção. Não gere Operations no frontend
automaticamente; esta sprint apenas agenda futuras execuções e permite vincular uma Operation real.

Endpoints disponíveis:

```http
GET    /maintenance-plans/stats
GET    /maintenance-plans?page=1&limit=20&equipmentId=&type=&priority=&active=
GET    /maintenance-plans/:id
POST   /maintenance-plans
PATCH  /maintenance-plans/:id
DELETE /maintenance-plans/:id

GET   /maintenance-plans/:id/executions?page=1&limit=20&status=&from=&to=
POST  /maintenance-plans/:id/executions
PATCH /maintenance-executions/:id

GET /equipments/:id/maintenance?page=1&limit=20
GET /equipments/:id/maintenance/upcoming?page=1&limit=20&status=&from=&to=
```

Payload para criar plano:

```ts
type CreateMaintenancePlanRequest = {
  equipmentId: string;
  name: string;
  description?: string;
  type: 'PREVENTIVE' | 'INSPECTION' | 'WARRANTY' | 'CUSTOM';
  priority?: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  recurrenceRule: {
    frequency: 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY' | 'INTERVAL_DAYS' | 'INTERVAL_MONTHS';
    interval?: number;
  };
  firstExecution: string;
  active?: boolean;
};
```

Payload de execução:

```ts
type MaintenanceExecution = {
  id: string;
  maintenancePlanId: string;
  operationId: string | null;
  scheduledAt: string;
  executedAt: string | null;
  status: 'PLANNED' | 'LINKED' | 'COMPLETED' | 'CANCELED';
  notes: string | null;
  createdAt: string;
  plan: MaintenancePlan;
  operation: {
    id: string;
    number: number;
    type: string;
    status: string;
    completedAt: string | null;
  } | null;
};
```

Estados importantes:

- `PLANNED`: execução planejada sem operação concluída;
- `LINKED`: execução vinculada a uma Operation ainda não concluída;
- `COMPLETED`: execução realizada; backend atualiza plano e Asset Lifecycle;
- `CANCELED`: execução cancelada para fins operacionais.

Paginação:

Todas as listagens retornam:

```ts
{
  items: T[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
}
```

UX recomendada:

- Em equipamento, carregar `GET /equipments/:id/maintenance` para planos e
  `GET /equipments/:id/maintenance/upcoming` para próximas execuções.
- Em dashboard, usar `GET /maintenance-plans/stats`.
- Exibir `nextExecution`, `lastExecution`, `priority` e `_count.executions` nos cards.
- Após concluir uma execução, invalidar timeline do equipamento; o backend cria evento
  `MAINTENANCE`.
- Não montar recorrência local além de validação visual; o cálculo oficial é do `RecurringEngine`.

Mocks que podem ser removidos:

- cards locais de manutenção futura;
- próximas preventivas simuladas;
- estatísticas manuais de planos ativos/vencidos;
- recorrência calculada no frontend como fonte de verdade.

Próximos endpoints previstos:

- PMOC sobre Maintenance Planning;
- geração assistida de Operations a partir de execuções planejadas;
- alertas;
- agenda automática;
- garantias inteligentes.

## PMOC Compliance — Sprint 11

O backend já expõe PMOC como domínio de conformidade sobre Maintenance Planning. Não criar mocks,
agenda paralela, execução paralela, timeline paralela ou PDF local.

Endpoints:

```http
GET    /pmoc/stats
GET    /pmoc?page=1&limit=20&customerId=&equipmentId=&active=
GET    /pmoc/:id
POST   /pmoc
PATCH  /pmoc/:id
DELETE /pmoc/:id

GET    /pmoc/:id/environments
POST   /pmoc/:id/environments
PATCH  /pmoc/environments/:id
DELETE /pmoc/environments/:id

GET /pmoc/:id/compliance
GET /equipments/:id/pmoc
```

Payload de criação:

```ts
type CreatePmocRequest = {
  customerId: string;
  equipmentId: string;
  equipmentIds?: string[];
  responsibleTechnician: string;
  artNumber?: string;
  contractNumber?: string;
  startDate: string;
  endDate: string;
  observations?: string;
  priority?: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  recurrenceRule: {
    frequency: 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY' | 'INTERVAL_DAYS' | 'INTERVAL_MONTHS';
    interval?: number;
  };
  active?: boolean;
};
```

Status:

- `COMPLIANT`: ativo, vigente e sem pendências próximas/vencidas;
- `WARNING`: execução PMOC próxima;
- `OVERDUE`: validade vencida ou execução vencida;
- `NON_COMPLIANT`: PMOC ou plano inativo;
- `IN_PROGRESS`: vigência ainda não iniciou.

Campos importantes:

- `maintenancePlan`: plano oficial de recorrência;
- `maintenancePlan.executions`: próximas execuções planejadas;
- `equipments`: equipamentos reais monitorados pelo PMOC;
- `environments`: ambientes e equipamentos associados;
- `compliance`: status calculado pelo backend;
- `document`: em `/pmoc/:id/compliance`, indica preparação para Document Engine.

UX:

- Página de cliente: carregar `GET /pmoc?customerId=<id>`.
- Página de equipamento: carregar `GET /equipments/:id/pmoc`.
- Dashboard: carregar `GET /pmoc/stats`.
- Detalhe PMOC: carregar `GET /pmoc/:id` e `GET /pmoc/:id/compliance`.
- Timeline: continuar usando Asset Lifecycle; eventos PMOC chegam como `PMOC_CREATED`,
  `PMOC_UPDATED`, `PMOC_COMPLETED`, `PMOC_EXPIRED`.

Mocks que podem ser removidos:

- status PMOC calculado localmente;
- próximas execuções PMOC simuladas;
- ambientes mockados;
- PDFs PMOC montados no frontend;
- timeline PMOC local.

Próximos endpoints previstos:

- Compliance Engine genérico;
- geração assistida de Operation a partir de PMOC;
- alertas de vencimento;
- workflow de aprovação;
- assinatura digital avançada.

## Inventory & Materials — Sprint 12

O backend agora possui o domínio oficial de inventário. Para frontend, a separação central é:

- `Product`: catálogo, descrição técnica e códigos;
- `InventoryItem`: saldo físico de um produto em uma localização;
- `StockMovement`: histórico imutável de entradas, saídas, consumo e retorno;
- `OperationPart`: material consumido em um atendimento.

Endpoints disponíveis:

```http
GET    /products
GET    /products/:id
POST   /products
PATCH  /products/:id
DELETE /products/:id

GET    /inventory
GET    /inventory/:id
PATCH  /inventory/:id
GET    /inventory/stats
POST   /inventory/movements
GET    /inventory/movements

GET    /suppliers
POST   /suppliers
PATCH  /suppliers/:id
DELETE /suppliers/:id

GET    /operations/:id/materials
POST   /operations/:id/materials
DELETE /operations/:id/materials/:id
```

Paginação:

Todos os endpoints de listagem retornam:

```ts
type Paginated<T> = {
  items: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
};
```

Campos importantes:

- `Product.sku`: identificador comercial único;
- `Product.internalCode`: código interno opcional e único;
- `Product.suppliers[]`: vínculos Product↔Supplier persistidos, com o fornecedor principal em
  `isPrimary=true`;
- `primarySupplierId`: campo opcional de `POST/PATCH /products` para definir/remover fornecedor
  principal (`null` remove);
- `InventoryItem.currentQuantity`: saldo físico atual recalculado pelo backend;
- `InventoryItem.reservedQuantity`: reserva administrativa;
- `InventoryItem.availableQuantity`: saldo disponível;
- `StockMovement.type`: `IN`, `OUT`, `ADJUSTMENT`, `TRANSFER`, `CONSUMPTION`, `RETURN`;
- `OperationPart.deletedAt`: indica material removido sem apagar histórico.

Consumo de material:

```ts
await api.post(`/operations/${operationId}/materials`, {
  productId,
  inventoryItemId,
  quantity: 1,
  notes: 'Peça substituída em manutenção corretiva',
});
```

Efeitos do backend:

- cria `OperationPart`;
- cria `StockMovement` do tipo `CONSUMPTION`;
- recalcula `InventoryItem`;
- rejeita saldo negativo;
- publica `PART_REPLACEMENT` no Asset Lifecycle quando a Operation possui equipamento.

Estados de UX:

- item abaixo do mínimo: `Number(availableQuantity) <= Number(minimumQuantity)`;
- item sem saldo: `Number(availableQuantity) <= 0`;
- produto inativo: `isActive = false`;
- movimento imutável: não exibir ação de editar movimento.

Mocks que podem ser removidos:

- estoque calculado localmente;
- materiais de Operation simulados;
- produtos mockados;
- fornecedores mockados;
- indicadores de consumo simulados.

Próximos endpoints previstos:

- compras;
- cotações;
- orçamento integrado a materiais;
- múltiplos almoxarifados;
- código de barras/QR de estoque.

## Pricing — Sprint 13

Pricing concentra custo, preço, margem e vigência. Não existe preço em `Product`; não existe custo em
`InventoryItem`.

Endpoints disponíveis:

```http
GET   /pricing/stats
GET   /pricing
GET   /pricing/:id
GET   /products/:id/pricing
POST  /products/:id/pricing
PATCH /pricing/:id
GET   /pricing/history/:productId
```

Paginação:

`GET /pricing` e `GET /pricing/history/:productId` usam o envelope paginado padrão:

```ts
type Paginated<T> = {
  items: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
};
```

Campos importantes:

- `costPrice`: custo base;
- `replacementCost`: custo de reposição;
- `averageCost`: custo médio;
- `salePrice`: preço vigente de venda;
- `minimumSalePrice`: piso comercial;
- `suggestedSalePrice`: preço sugerido;
- `marginPercentage`: margem calculada/validada pelo backend;
- `validFrom` / `validUntil`: vigência;
- `active`: preço ativo para resolução.

Fluxo recomendado:

```ts
const current = await api.get(`/products/${productId}/pricing`);
const history = await api.get(`/pricing/history/${productId}?page=1&limit=20`);
```

Criar preço:

```ts
await api.post(`/products/${productId}/pricing`, {
  costPrice: 42.5,
  replacementCost: 45,
  averageCost: 43.8,
  salePrice: 78,
  minimumSalePrice: 68,
  suggestedSalePrice: 82,
  validFrom: '2026-07-01T00:00:00.000Z',
});
```

Revisar preço:

```ts
await api.patch(`/pricing/${pricingId}`, {
  salePrice: 84,
  validFrom: '2026-08-01T00:00:00.000Z',
});
```

O PATCH cria uma nova vigência. A UI deve tratar o retorno como novo registro.

Mocks que podem ser removidos:

- preço hardcoded em produto;
- margem calculada somente no frontend;
- custos simulados em estoque;
- histórico comercial local.

Próximos endpoints previstos:

- tabelas de preço;
- orçamento;
- financeiro;
- descontos;
- contratos comerciais.

## Assignment Domain + Operator Workflow

Use Assignment para todo fluxo de campo do Operator. A Operation continua sendo a entidade principal;
Assignment apenas controla execução.

Endpoints disponíveis:

```http
GET   /assignments?page=1&limit=20&operationId=&assignedTo=&customerId=&equipmentId=&status=
GET   /assignments/my?page=1&limit=20&status=
GET   /assignments/:id
GET   /assignments/history/:operationId
POST  /assignments
PATCH /assignments/:id/reassign
PATCH /assignments/:id/accept
PATCH /assignments/:id/reject
PATCH /assignments/:id/start
PATCH /assignments/:id/complete
```

Payloads:

```ts
type CreateAssignmentPayload = {
  operationId: string;
  assignedTo: string;
  notes?: string | null;
};

type ReassignAssignmentPayload = {
  assignedTo: string;
  notes?: string | null;
};
```

Estados:

- `ASSIGNED`: mostrar CTA Aceitar;
- `ACCEPTED`: mostrar CTA Iniciar;
- `STARTED`: mostrar CTA Continuar/Concluir;
- `COMPLETED`: somente leitura;
- `REJECTED`/`CANCELED`: somente leitura;
- `PAUSED`: reservado para retomada futura.

Observações UX:

- Home Operator deve priorizar Hoje, Minhas atividades, Em andamento, Próximas e Atrasadas;
- Minhas Ordens deve consumir somente `/assignments/my`;
- Timeline da Assignment vem de `/assignments/history/:operationId`;
- Platform Agenda é apenas visão de Assignments; não criar domínio local de agenda;
- Operation Drawer deve exibir responsável, status e histórico de Assignment.

Mocks que podem ser removidos:

- schedule demo no Operator Home/Agenda/Services;
- cards locais de serviços;
- timeline local de execução do operador.

## Budget Domain — Orçamentos comerciais

Use estes endpoints para construir a futura área comercial/orçamentos. Não usar mocks de preço,
subtotal ou margem.

Endpoints disponíveis:

```http
GET    /budgets?page=1&limit=20&search=&status=&customerId=&equipmentId=&operationId=&from=&to=&expired=
GET    /budgets/:id
GET    /operations/:id/budgets?page=1&limit=20
POST   /budgets
PATCH  /budgets/:id
PATCH  /budgets/:id/approve
PATCH  /budgets/:id/reject
DELETE /budgets/:id
GET    /budgets/stats
GET    /budgets/history/:id?page=1&limit=20
```

Campos importantes:

- `number`: sequencial oficial do orçamento;
- `status`: estado comercial;
- `serviceSubtotal`, `materialSubtotal`, `serviceDiscount`, `materialDiscount`, `discount`,
  `additional` e `total`: strings decimais vindas do backend; `discount` é a soma dos descontos
  por categoria;
- `serviceDiscountDescription` e `materialDiscountDescription`: textos editáveis exibidos na linha
  de desconto da respectiva tabela documental;
- `items[].snapshotCost`: custo congelado no momento da criação/revisão;
- `items[].snapshotSalePrice`: preço de venda congelado;
- `items[].snapshotMargin`: margem congelada;
- `expirationDate`: data limite para aprovação;
- `operationId`: opcional; uma Operation pode ter vários orçamentos;
- `approvedAt` e `rejectedAt`: timestamps de decisão.

Payload mínimo:

```ts
await api.post('/budgets', {
  customerId,
  operationId,
  equipmentId,
  title: 'Troca de componentes',
  expirationDate: '2026-07-17T00:00:00.000Z',
  status: 'PENDING',
  items: [{ productId, quantity: 2, description: 'Filtro G4' }],
});
```

Decisão:

```ts
await api.patch(`/budgets/${budgetId}/approve`, {
  observation: 'Aprovado pelo cliente',
});

await api.patch(`/budgets/${budgetId}/reject`, {
  observation: 'Cliente recusou a proposta',
});
```

Estados para UI:

- `DRAFT`: badge cinza/azul, permitir editar;
- `PENDING`: badge amarelo, permitir editar/aprovar/rejeitar;
- `APPROVED`: badge verde, somente leitura;
- `REJECTED`: badge vermelho, somente leitura;
- `EXPIRED`: badge laranja/vermelho, somente leitura;
- `CANCELED`: badge cinza, somente leitura.

Paginação:

- todas as listagens retornam `{ items, pagination }`;
- preservar filtros ao trocar `page` e `limit`.

Observações de UX:

- para adicionar item, mostrar produtos do catálogo e deixar o backend resolver preço;
- se voltar `PRICING_NOT_FOUND`, abrir CTA para cadastro/revisão de preço;
- se voltar `BUDGET_MULTIPLE_APPROVAL`, mostrar orçamento aprovado existente na Operation;
- ao aprovar/rejeitar, atualizar Timeline do equipamento porque o backend publica eventos de lifecycle;
- não exibir Budget para OPERATOR/VIEWER.

Mocks que podem ser removidos:

- orçamentos locais;
- cálculo local de snapshot;
- preço hardcoded em item de orçamento;
- status comercial simulado;
- timeline local de orçamento aprovado/rejeitado.

Próximos endpoints previstos:

- reserva futura de estoque;
- conversão futura para financeiro;
- envio futuro por e-mail/WhatsApp.

## Budget Document Emission

Endpoints disponíveis para a UI:

- `POST /api/v1/budgets/:id/render`;
- `GET /api/v1/budgets/:id/download`.

Contrato de render:

```ts
type BudgetRenderResult = {
  documentId: string;
  preview: DocumentBlueprint;
  download: string;
  status: 'READY' | 'DRAFT' | 'VALIDATED' | 'SENT';
  document: OperationDocument & { budgetId: string };
};
```

Contrato de download:

```ts
type BudgetDownload = OperationDocument & {
  budgetId: string;
  contentBase64: string;
};
```

Observações de UX:

- Remover placeholder de "render/download futuro".
- "Visualizar Documento" deve abrir `DocumentViewer` com `documentId` real.
- "Emitir Documento" chama `POST /budgets/:id/render` e atualiza o Budget/drawer.
- "Baixar PDF" chama `GET /budgets/:id/download`.
- Não utilizar `GET /documents/templates/:templateId/preview` como documento emitido.
- Se o Budget estiver `CANCELED` ou `REJECTED`, a emissão deve ficar bloqueada.
- Em erro 404 de download, mostrar "Documento ainda não emitido".

Mocks que podem ser removidos:

- card de documento aguardando contrato backend;
- qualquer fallback visual baseado apenas no template `BUDGET`;
- qualquer download local de PDF.

## Financial Core — Orbit V1

Endpoints reais:

- `GET/POST/PATCH/DELETE /financial/accounts`;
- `GET/POST/PATCH/DELETE /financial/categories`;
- `GET/POST/PATCH /financial/entries`;
- `PATCH /financial/entries/:id/pay`;
- `PATCH /financial/entries/:id/cancel`;
- `GET /financial/stats`;
- `GET /financial/history/:id`.

Tipos principais:

```ts
type FinancialEntryType = 'RECEIVABLE' | 'PAYABLE' | 'TRANSFER';
type FinancialEntryStatus = 'PENDING' | 'PAID' | 'CANCELED' | 'OVERDUE';
type FinancialEntryOrigin = 'MANUAL' | 'BUDGET' | 'PURCHASE' | 'OPERATION' | 'PMOC' | 'OTHER';
```

Observações de UX:

- exibir Financeiro apenas para OWNER/MANAGER;
- usar `/financial/stats` para cards: receber hoje, pagar hoje, atrasados, saldo atual e saldo previsto;
- `totalPages` segue o contrato global;
- lançamento pago é final para a V1;
- Budget aprovado não gera financeiro automaticamente;
- conversão de Budget para lançamento será fluxo manual/futuro usando `origin=BUDGET`.

Mocks que podem ser removidos:

- cards financeiros locais;
- listas locais de contas/categorias;
- cálculo local de saldo atual/projetado.

## Procurement — Compras V1

Endpoints:

- `GET /purchase-orders`;
- `GET /purchase-orders/:id`;
- `POST /purchase-orders`;
- `PATCH /purchase-orders/:id`;
- `PATCH /purchase-orders/:id/send`;
- `PATCH /purchase-orders/:id/cancel`;
- `GET/POST /purchase-orders/:id/items`;
- `PATCH/DELETE /purchase-order-items/:id`;
- `GET/POST /purchase-orders/:id/receipts`;
- `GET /purchase-orders/stats`;
- `GET /purchase-orders/history/:id`.

UX:

- tela de pedidos com filtros por fornecedor/status/período;
- drawer de pedido com abas: itens, recebimentos, histórico;
- recebimento parcial deve permitir múltiplas linhas;
- mostrar progresso por item: recebido/comprado;
- bloquear edição quando status for `RECEIVED` ou `CANCELED`.

Importante:

- não criar estoque local;
- não alterar saldo físico no frontend;
- recebimento chama backend, backend cria `StockMovement(IN)` via Inventory;
- não criar financeiro automático na V1.

## Sprint 19 — comportamento de concorrência para o frontend

O backend agora rejeita com `409` operações que perderem corrida de estado. Isso é intencional e
protege dinheiro, estoque, documentos e histórico.

Implementação esperada no Opus:

- Para ações destrutivas ou finalizadoras, não usar retry automático silencioso.
- Em `409`, fechar loading, exibir toast informativo e refazer `GET` do recurso.
- Se o usuário ainda puder agir após refresh, deixar a ação disponível novamente.

Áreas com refresh obrigatório após conflito:

- Financeiro: Entry detail/list.
- Compras: PurchaseOrder detail, itens e receipts.
- Estoque: Inventory item e Operation materials.
- Assignments: Assignment detail/my list.
- Budgets: Budget detail/history/document.
- Pricing: Product pricing/history.
- DocumentViewer: document metadata antes de novo render/download.

Não há mocks ou contratos novos nesta etapa.

## Sprint 19.5 — provas disponíveis para o frontend

O backend agora possui scripts oficiais para comprovar concorrência real:

- `npm run test:integration`;
- `npm run test:concurrency`.

Esses testes usam PostgreSQL real e `TEST_DATABASE_URL` obrigatório com banco `_test`.

Impacto para Opus:

- manter tratamento de `409` com refresh;
- não adicionar locks locais;
- não implementar retry automático em comandos de compra/estoque/budget/assignment;
- Financial já trata internamente retry seguro de conflito serializável em pagamento/cancelamento.

Na Sprint 19.5, Document Engine failure boundary ainda bloqueava o veredito final; a Sprint 19.6
fecha esse bloqueio.

## Sprint 19.6 — integração após certificação

O bloqueio de Document Engine foi fechado.

Para Opus:

- Remover qualquer fallback local para falha de render; usar retry oficial após refresh.
- Tratar download indisponível como documento não recuperável no momento, sem exibir storage key.
- Pricing adjacency agora é válida quando `validUntil` de um preço é igual ao `validFrom` do próximo.
- Nenhuma nova rota foi criada para o frontend.

Veredito backend de integridade: `ORBIT_BACKEND_INTEGRITY_READY`.

## Sprint 20 — AppSec notes for Opus

No new routes were added.

Payload changes to respect:

- `POST /financial/entries`: never send `status` or `paidAt`.
- Entries are created as `PENDING`; use `/financial/entries/:id/pay` for payment.

Upload UX:

- Organization assets now reject MIME spoofing and active SVG payloads.
- Treat `UPLOAD_INVALID_MIME_TYPE` as a user-facing invalid-file error.
- Do not expose storage keys or use local file paths.

Commercial confidentiality:

- OPERATOR and VIEWER must not see Pricing/Financial/Budget/Procurement navigation or actions.
- Product endpoints remain safe for OPERATOR/VIEWER and do not include Pricing cost/margin fields.

Security regression command available to backend developers:

```bash
TEST_DATABASE_URL='postgresql://user:pass@127.0.0.1:5432/orbit_security_test?schema=public' npm run test:security
```

## Sprint 20.5 — AppSec closure notes for Opus

No new routes were added.

Asset Lifecycle is now a sanitized public timeline API:

- do not read or expect raw `metadata`;
- do not read or expect `storageKey`;
- do not read or expect attachment `eventId`/`deletedAt`;
- do not display performer e-mail from timeline payloads;
- render cards from `timeline.title`, `timeline.subtitle`, `timeline.description`, `timeline.icon`,
  `timeline.color`, `timeline.badges` and `timeline.references`;
- object URLs in local photo preview flows must be revoked after use.

The closure suite verifies Document Engine, Signatures, Maintenance, PMOC, Asset Lifecycle,
Inventory, Procurement, audit metadata, rate limit and IDOR/BOLA boundaries against the real backend.

## Sprint 22 — production readiness notes for Opus

No business endpoint was added or removed.

For production-like frontend integration, use:

- API base URL: `/api/v1` when served behind the same reverse proxy;
- metrics endpoint: `GET /api/v1/metrics`;
- health endpoints: `GET /api/v1/health` and `GET /api/v1/health/ready`.

Release validation commands available to the backend package:

```bash
npm run release:smoke:frontend
npm run release:workflows
```

The critical workflow runner validates real API flows for auth, users, customers, equipment/QR,
inventory, pricing, delegated operations, Assignment workflow, Asset Lifecycle, budgets/document
rendering, financial entries and procurement receipts.

Opus/frontend must consume only production domain APIs. No demo flag, dataset bridge or example
fallback exists.

## Sprint 22.5 — Opus external closure notes

No frontend-facing API contract changed.

Operational assumptions for V1:

- one frontend/API deployment per customer installation;
- one database per customer installation;
- one persistent storage scope/path per customer installation;
- no shared application-level multi-tenancy;
- object storage is not certified for V1.

Frontend lockfile supply-chain status:

- `postcss` advisory remediated through targeted override;
- `npm audit --json` reports 0 vulnerabilities after the Sprint 22.5 change.

## Product Backlog Closure 02 — Opus integration notes

Para implementar UX de relatórios:

- use `DocumentViewer` com `source={{ operationId, type }}`;
- use apenas tipos existentes: `WORK_ORDER`, `TECHNICAL_REPORT`, `REPORT`, `PMOC`, `QUOTE`, `RECEIPT`, `BUDGET`;
- para Budget, preserve o fluxo próprio de `/budgets/:id/render` quando estiver na Central Comercial;
- para documentos de Operation, use `/documents/operations/:operationId/:type/*`;
- após render, o documento aparece no histórico oficial de documentos quando o backend criar/atualizar `OperationDocument`.

Limitação V1:

- “Relatório Técnico” e “Laudo” do frontend ainda compartilham `DocumentTemplateType.REPORT`.
- Não criar tipo local novo; se o produto precisar diferenciar ambos, abrir backlog para novo enum/contrato backend.

## Document Semantics Closure — Opus update

A limitação acima foi fechada.

Use:

- `TECHNICAL_REPORT` para Relatório Técnico.
- `TECHNICAL_OPINION` para Laudo Técnico.
- `REPORT` apenas como tipo legado/histórico quando retornado pelo backend.

Na UI:

- “Visualizar modelo” deve usar template preview e ocultar render/download.
- “Pré-visualizar com dados reais” deve exigir Operation e permitir render/download conforme RBAC.

## Product Backlog Closure 03 — Opus integration notes

PDF exports:

```http
GET /operations/export
GET /documents/export
GET /equipments/export
```

- retornam `application/pdf` raw;
- usar `Blob`;
- usar filename de `Content-Disposition` quando existir;
- preservar filtros ativos;
- limite: 500 registros.

Assinaturas:

- `GET /signatures` retorna ativas e inativas, nunca soft-deleted;
- campo de imagem público: `hasImage`;
- não existe `imageStorageKey` no contrato público;
- desenho livre deve virar PNG e ser enviado ao mesmo `POST /signatures/:id/upload`.

## Product Backlog Closure 04 — Avatar Crop e Notifications

Frontend deve usar:

- `POST /users/avatar` para persistir PNG final já recortado;
- `GET /users/me` após upload/remove para sincronizar shell;
- `GET /users/avatar/:id` para render autenticado;
- `GET /notifications/unread-count` para badge;
- `GET /notifications` para painel;
- `PATCH /notifications/:id/read` e `/notifications/read-all` para estados reais.

Não usar storage keys, AuditLog, notificações locais fake ou URLs externas.

# Closure 06 — instruções para Work Order

Para OS, use somente `operationId + WORK_ORDER`. `templateId` é preview estrutural e
`TECHNICAL_REPORT` pertence ao relatório de visita. Depois de qualquer mutation de assinatura,
checklist, observação, foto, material ou estado, recarregue a Operation e renderize novamente.
Download com HTTP 409/`DOCUMENT_STALE` deve mostrar ação de re-renderização.

Datas: `createdAt` é criação; `scheduledFor` é agendamento; nunca faça fallback para `assignedAt`.

# Closure 06.1 — verificação de produto

Verificado em `/operacoes`: colunas Criado/Data do agendamento, seção Datas no drawer e OS real com
assinatura. O PDF usa Noto Sans incorporada e preserva português. Não comparar preview de modelo com
PDF real; para emissão use sempre `operationId + WORK_ORDER`.

## DC02B — contrato pronto para UI

- Organization: `stateRegistration?: string`, `phoneNumbers: string[]`.
- Operation detail: `referenceMonth`, `referenceYear`, `maintenanceType`,
  `maintenanceChecklistItems[]`, `inspectedEquipments[]`.
- Create/Patch usa `maintenanceChecklist[]` e `inspectedEquipments[]` conforme `API_CONTRACTS.md`.
- O seletor sempre usa `/equipments?customerId=<selecionado>`.
- O frontend não envia marca/modelo/capacidade; o backend é a autoridade dos snapshots.
- Preview/PDF usam o mesmo Blueprint; `header.corporate` contém a identificação renderizável.
- Campos novos são opcionais; não use fallback fake.

## Product Backlog Closure 08 — contrato para Opus

Use `technicalCatalogsApi` para `types`, listagem, CRUD e reorder. A página existente
`/maintenance-checklists` agora representa **Catálogos Técnicos** e deve manter as cinco tabs
entregues por `GET /technical-catalogs/types`.

Seletores de documento:

```text
GET /technical-catalogs?type=OBJECTIVE&active=true&page=1&limit=100
GET /technical-catalogs?type=SITE_CONDITION&active=true&page=1&limit=100
GET /technical-catalogs?type=RECOMMENDATION&active=true&page=1&limit=100
GET /technical-catalogs?type=CONCLUSION&active=true&page=1&limit=100
```

Persistência: transforme a lista ordenada em texto separado por newline nos campos
`technicalOpinion*` da Operation. Catálogo é auxílio de entrada; o documento histórico usa snapshot.
Não buscar catálogo no Viewer e não montar PDF/Preview local.

RBAC: OWNER/MANAGER gerenciam; OPERATOR/VIEWER consultam. A UI oculta mutations sem permissão, mas
deve tratar 403 do backend como autoridade final.

Closure 08.1: use `technicalCatalogsApi.taxonomy()` e `list({ type, areas,
workflow, includeGeneral: true, active: true, page: 1, limit: 100 })`. Não carregue o catálogo
inteiro para filtrar apenas no browser. Itens já selecionados são snapshots e permanecem visíveis
mesmo fora do resultado contextual atual.

# Technical Report workflow closure (2026-07-14)

- Equipment selection belongs exclusively to the Content step and maps to `inspectedEquipments[]`.
- Checklist choices come from `/maintenance-checklist-templates`, then map to Operation snapshot items.
- OWNER/MANAGER may create catalog entries; VIEWER is read-only; OPERATOR has no catalog endpoint access.
- Do not persist catalog IDs in the Operation payload and do not render catalog data directly in a document.
- The report workflow exposes image upload only for PMOC.

# Work Order independent creation closure — 14/07/2026

- O wizard possui `EXISTING` e `NEW`; `NEW` cria Operation DRAFT oficial.
- A OS usa `inspectedEquipments[]` para múltiplos equipamentos.
- Preview/render/download continuam pelos endpoints do Document Engine.
- `imageGallery` é um componente aditivo do Blueprint com duas colunas; não criar fallback local.
- Fotos, observações e assinatura são condicionais. Materiais e documentos relacionados não fazem
  parte da OS atual.

## DC-04 PMOC

- Platform seleciona plano, múltiplos equipamentos e procedimentos por equipamento.
- Operator preenche a execução vinculada usando `YES | NO | NOT_APPLICABLE`, fotos e assinatura.
- A API nunca retorna a imagem coletada; use `signatureCaptured` para o estado visual.
- Preview/PDF são sempre o tipo `PMOC` no DocumentViewer oficial.

## Laudo Técnico — contrato narrativo

No wizard de `TECHNICAL_OPINION`, mantenha o parecer livre em
`technicalOpinionObjective`/`technicalOpinionConclusion` e os itens selecionados nos arrays
`technicalOpinionObjectiveItems`/`technicalOpinionConclusionItems`. Os arrays são snapshots e
devem ser reenviados ao editar; não reconstrua o texto principal a partir deles.

## PMOC sem plano prévio

Na Central de Relatórios, ofereça `Criar novo PMOC` e `Selecionar PMOC existente`. Um novo plano é
criado diretamente por `POST /pmoc`, recebe número próprio e não depende de Operation. Ao avançar,
crie a Operation/OS oficial e vincule-a à execução planejada. Para planos existentes, exponha
edição e remoção lógica pelos endpoints já oficiais.

## PMOC UX-01 — implementação frontend

- Wizard único: `PmocPlanWizard`.
- Equipamentos e tipos: `MultiSelect` → `equipmentIds[]`/`serviceTypes[]`.
- Assinaturas: consultar configuração PMOC; nunca inferir modo no cliente.
- Override: enviar apenas `signatureOverrideId`, sem alterar o modelo.
- Operator: coleta apenas em `COLLECTED`/`HYBRID`; `FIXED` é institucional; `NONE` não tem etapa.
- OS e documento permanecem nos endpoints oficiais de Operations, Assignments e Document Engine.

## Field Report Handoff 01 — contrato para UI

- Operator: `FieldReportHandoff` está em `/operator/services/:assignmentId`; salva Operation e o
  handoff oficial, coleta assinatura conforme a matriz e somente envia para revisão.
- Platform: `DocumentHandoffInbox` está em `/reports`; oferece filtros, revisão completa, evidências,
  previews reais de assinatura, seleção técnica e `DocumentViewer` após READY.
- Repositório: `/documentos` usa `editorialStatus` e mostra `v{version} · r{revision}`.
- Nunca derive autorização no frontend. Operator sem Assignment recebe 403; render/finalização pelo
  Operator recebem 403 mesmo com chamadas diretas.
- Não reutilize `signatureMode` para novos handoffs. Os campos legados permanecem apenas para
  compatibilidade histórica e layout do template.

## PMOC FIX-01

`/pmoc/:id` apresenta as ações **Pré-visualizar**, **Gerar PDF**, **Baixar PDF** e, quando o
fingerprint oficial divergir, **Gerar novamente**. Todas reutilizam `DocumentViewer` e os endpoints
de `/documents`; não implemente download por Storage nem geração no cliente. O documento renderizado
é listado automaticamente em `/documentos?type=PMOC`.
- Clientes devem remover qualquer emissão PDF mobile/local; o único caminho é o Document Engine.
# PMOC FIX-02A

O Wizard oficial da Platform agora revisa assinaturas de PMOC. Consumir `customerSignature.collectedBy`, nunca inferir o coletor pelo operador atual. A política `NONE/FIXED/COLLECTED/HYBRID` continua vindo da configuração do template; o frontend não decide quais blocos serão renderizados.

## PMOC FIX-02B

Na etapa Evidências do `PmocPlanWizard`, consuma somente `operationApi`: detalhe, conteúdo autenticado, upload em lote, atualização de legenda e remoção. Cada mutação invalida o artefato no backend; refaça o Preview. A grade oficial é 1/2/4 colunas e o uploader aceita seleção múltipla/drag-and-drop. Não há API ou storage específico de PMOC.

## Operator self-service / management review

- Use `requestedDocumentType` como tipo oficial do atendimento atribuído.
- `assignmentOrigin: OPERATOR` + `workflowStatus: DRAFT`: criado no campo e aguardando aprovação.
- `assignmentOrigin: MANAGEMENT` + `workflowStatus: REVIEW`: delegado pela gestão, executado e devolvido.
- PMOC iniciado no PWA significa assumir uma Execution Request elegível; não criar plano nem Operation paralela.
## DC-06 — Orçamento

- Wizard oficial: origem, dados gerais, serviços, materiais, valores, condições e assinaturas.
- BudgetItem.type: SERVICE | MATERIAL. description, quantity, unit e unitPrice são obrigatórios; productId é opcional e não deve ser exigido.
- Formas de pagamento: CASH, PIX e CREDIT_CARD, com seleção múltipla.
- Preview: GET /budgets/:id/preview. Render/download continuam nos endpoints Budget.
- O OperationDocument criado com o Budget fornece o documentId para handoff e DocumentViewer.

## Operation review flow (assigned executions)

`OperationStatus` now includes `PENDING` and `REVIEW`. Lifecycle synced with the
Assignment: assignment created/reassigned → operation `PENDING`; operator starts →
`IN_PROGRESS`; operator completes the field execution → `REVIEW` (awaiting the
technical responsible). Approval: `PATCH /operations/:id/approve` (OWNER/MANAGER)
moves `REVIEW` → `COMPLETED` and fires the completion side-effects (asset
lifecycle + PMOC execution sync). Invalid transitions return
`OPERATION_INVALID_TRANSITION` (409). Migration: `20260719140000_operation_review_flow`.

Operator PWA: starting a non-PMOC assignment opens the guided execution wizard
(`/operator/execucao/:assignmentId`) — Checklist → Coleta → Fotos → Materiais →
Revisão do cliente (overview + assinatura). Finishing submits the handoff and
completes the assignment, sending the operation to `REVIEW`.
# Customer Workspace / Sales handoff

Implementação visual oficial: `/clientes` → `/clientes/:id` → abas Equipamentos, Serviços e Vendas. Vendas usam `salesApi`; itens enviados contêm apenas `productId` e `quantity`. O backend retorna snapshots e totais. O atalho “Criar recibo” abre `/reports?create=RECEIPT&saleId=:id`; o Wizard consulta o prefill real e não usa mock.
# Operator onboarding signature

O componente compartilhado `ChangePasswordScreen` possui dois passos no variant `operator`: senha definitiva e assinatura técnica. A chamada final é `usersApi.completeFirstAccess(payload, file)`. A assinatura passa a aparecer automaticamente nos seletores oficiais já alimentados por `signaturesApi.listSignatures({ active: true })`.
# Product purchase/sale handoff — 2026-07-22

O catálogo continua único. Use `isPurchasable` e `isSellable` para apresentar as abas Produtos comprados e Produtos vendidos, respectivamente. O formulário permite marcar uma ou ambas as finalidades. Cliente > Vendas consulta apenas `GET /products?sellable=true`; Purchase Orders e materiais usam `purchasable=true`. Não derive essas classificações de estoque, preço ou fornecedor.
# Simplified product form handoff — 2026-07-22

O cadastro sugere códigos editáveis e apresenta somente dados principais/valores inicialmente. Campos técnicos, fornecedor e descrição são progressivos. Valores são enviados ao Pricing após criar o Product; falha nessa segunda chamada deve ser apresentada como sucesso parcial, sem recriar o produto.
# Inventory/Sales availability handoff — 2026-07-22

Estoque usa linguagem de negócio: Saldo físico, Quantidade separada e Disponível para uso. Movimentos expostos na UI são Adicionar, Retirar e Devolução, todos sobre o endpoint oficial. Cliente > Vendas monta opções a partir de Pricing vigente na data, mostrando nome, SKU e valor; produtos sem preço não são selecionáveis.

# Operator Work Order parity — 2026-07-22

- OS/RVT no Operator usam campos separados `reportedIssue`, `serviceDescription` e `observations`, iguais aos consumidos pelo DocumentContext.
- A assinatura do cliente/responsável é obrigatória no mobile: imagem, nome e instante de coleta; função/vínculo é opcional.
- Reutilizar o mesmo `signedAt` em Operation e handoff. O PDF oficial renderiza a data/hora em linha própria no bloco de assinatura.
- `POST /operations` pode retornar 400 e `PATCH /assignments/:id/complete`, 409, ambos com `DOCUMENT_CUSTOMER_SIGNATURE_REQUIRED`.

OS e RVT autônomos ou atribuídos apresentam conferência completa junto à assinatura e terminam em `Concluir e gerar PDF`. O status textual dentro do documento é fornecido em pt-BR pelo Builder; não mapear novamente no DocumentViewer.

# Operator own technical signature

Use exclusivamente `signaturesApi.getMySignature/saveMySignature/downloadMySignatureImage`. A assinatura própria é pré-selecionada no passo Assinatura de OS/RVT e persistida pelo endpoint oficial de seleção do handoff. O backend rejeita IDs de terceiros; nunca carregue o catálogo global no mobile.
## Catálogo de checklist do RVT — 2026-07-23

- A aba visual `Checklist do RVT` é uma projeção de `TechnicalCatalog`, não um domínio novo.
- Filtro oficial: `CHECKLIST + TECHNICAL_REPORT + includeGeneral=false`.
- Periodicidades V1: `WEEKLY` e `SEMIANNUAL`.
- OS/PMOC utilizam `workflowsAny=WORK_ORDER,PMOC` e permanecem isolados do RVT.
- Platform e Operator consomem a mesma origem; não manter arrays ou defaults locais.

# PMOC Detail — Passo 2

- `PmocExecutionRequest.equipmentId` identifica o ativo atendido.
- Resumo: lista paginada dos equipamentos cobertos.
- Execuções: uma linha por equipamento, último estado, OS, documento e ação `Executar`.
- O wizard dedicado possui Identificação, Escopo, Evidências e Confirmação.
- Evidências são opcionais e limitadas a seis.
- O submit usa PMOC → Operation → Document Engine; Timeline e DocumentViewer são reutilizados.
# PMOC — fluxo mobile por equipamento (2026-07-27)

No Operator, OWNER seleciona um PMOC ativo, escolhe um equipamento coberto e abre o executor
reutilizado da Platform. Não existe criação de plano no mobile. O fluxo usa os endpoints PMOC já
documentados e termina no download/compartilhamento autenticado do Document Engine.

Assinaturas técnicas são elegíveis quando `Signature.userId` referencia um OWNER ativo e a
assinatura possui imagem. A associação é administrada em Configurações > Assinaturas; não inferir
responsabilidade técnica pelo nome, cargo ou assinatura padrão.
# Cancelamento operacional — 2026-08-02

- O detalhe do Assignment oferece cancelamento nos estados `ASSIGNED`, `ACCEPTED`, `STARTED` e
  `PAUSED`.
- O wizard possui somente Evidências e Motivo/Assinaturas. Nada é persistido antes da confirmação.
- `Operation.cancellations[0]` fornece status, motivo, ator, datas, assinatura técnica pública e
  metadados das fotos. Conteúdo das imagens continua em `/operations/photos/:photoId`.
- Na gestão, `REQUESTED` permite Render oficial, reagendamento ou aprovação definitiva.
- Nunca renderizar `customerSignatureData`, metadata como HTML ou qualquer path de Storage.
# Handoff — equipamento identificado pelo Operator

- Gatilho: Operation atribuída em execução, sem `equipment` e sem `inspectedEquipments`.
- Endpoint: `POST /operations/:id/equipments`.
- UX: seleção múltipla de equipamentos existentes mais formulário repetível para novos ativos.
- Campos mínimos adotados pelo app: tipo, marca, modelo e capacidade; setor, série e tensão são
  opcionais.
- Após sucesso, usar os `inspectedEquipments` retornados no resumo, Preview e conclusão.
- O endpoint é one-shot: depois do primeiro vínculo, novas chamadas retornam conflito.

# Cliente novo em campo com vários equipamentos

- Reutilizar o formulário repetível do atendimento atribuído na OS avulsa.
- Persistir por `POST /customers/walk-in` com `equipments[]` (máximo 20).
- Usar os IDs reais de `response.equipments` nos snapshots da Operation.
- `equipment` singular é somente compatibilidade e não deve ser usado em implementações novas.

## RVT Planning (2026-08-03)

- Clients oficiais: `/rvt-plans`, `/rvt-plans/:id/executions`, `/rvt-executions/:id/prefill`, `/rvt-executions/:id/prepare`, `/rvt-plans/ad-hoc`.
- Configuração não possui Preview/PDF. Após `prepare`, consumir Operation/Assignment e Document Engine oficiais.
- O cálculo visual do wizard é estimativa; as ocorrências persistidas pelo backend são a autoridade.
- Não criar placeholder para assinatura do cliente ausente no RVT.
- Para concluir, converta `maintenanceChecklistItems` no DTO explícito antes de `PATCH /operations/:id`;
  os objetos de resposta contêm metadados read-only incompatíveis com a whitelist de escrita.
- `POST /rvt-executions/:id/prepare` devolve a Assignment primária para ocorrências não finais;
  use seu `id` nas transições e não tente inferir uma atribuição pela Operation.
- Checklist configurado chega marcado e pode ser desmarcado.
- Auxiliares usam `isPrimary=false`, aparecem apenas para acompanhamento e não compõem o documento.
# Hotfix RVT — preparo e download (2026-08-03)

- A preparação cria/reutiliza uma única Assignment primária e retorna sua projeção em
  `OperationDetail.assignment`.
- Para execução concluída com documento `READY`, use `GET /documents/:id/download` e inicie o
  download autenticado do blob na própria tela.

## RVT — ajustes de integração 2026-08-03

- A Operation preparada contém checklist Semanal e Semestral; apenas o grupo escolhido é executável.
- Não crie placeholder de assinatura do cliente quando `executionSignatures` estiver vazio.
- `ReassignAssignmentPayload` aceita `auxiliaryOperatorIds?: string[]`; use uma única chamada para
  persistir toda a equipe e exiba confirmação somente após resposta bem-sucedida.
- A conclusão do RVT atribuído retorna ao fluxo compartilhado de sucesso documental, com download,
  compartilhamento, Documentos, novo atendimento e início.
- O cabeçalho do RVT continua exibindo seu identificador documental; a seção de identificação exibe
  a sequência própria da execução. O frontend não deve substituir esses valores no Preview.
