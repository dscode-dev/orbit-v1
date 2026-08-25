# API Contracts

## Portal do Cliente

Identidades e tokens deste contrato não são aceitos em `/auth/*` nem nas APIs internas.

- `POST /api/v1/customer/auth/login` — `{ email, password }`; retorna tokens rotativos.
- `POST /api/v1/customer/auth/refresh` e `POST /api/v1/customer/auth/logout`.
- `GET /api/v1/customer/me` e `POST /api/v1/customer/change-password`.
- `GET /api/v1/customer/operations?page&limit&search`, `GET /customer/operations/:id`.
- `GET /api/v1/customer/equipments`, `GET /customer/equipments/:id`.
- `GET /api/v1/customer/tickets?page&limit&status&search`, `GET /customer/tickets/:id`.
- `POST /api/v1/customer/tickets`.

Payload mínimo do chamado:

```json
{
  "documentType": "WORK_ORDER",
  "title": "Equipamento sem refrigeração",
  "description": "O equipamento deixou de refrigerar durante a operação."
}
```

Opcionais: `addressId`, `equipmentIds` (máximo 20), `operationType`, `serviceTypes`, `priority`,
`preferredDate`, `contactName`, `contactPhone`. A UI oferece `WORK_ORDER`, `TECHNICAL_REPORT` e
`TECHNICAL_OPINION`.

Administração:

- `GET|POST /api/v1/customer-portal/accounts` (GET exige `customerId`).
- `GET /api/v1/customer-portal/accounts/directory?page&limit&search&status` — diretório paginado
  para Gestão > Usuários; `status` aceita `ACTIVE` ou `INACTIVE` e cada item inclui somente a
  projeção pública do cliente vinculado.
- `PATCH /api/v1/customer-portal/accounts/:id/disable`.
- `PATCH /api/v1/customer-portal/accounts/:id/reset-password`.
- `GET /api/v1/service-tickets` e `GET /service-tickets/:id`.
- `GET /api/v1/service-tickets/:id/operation-prefill`.
- `POST /api/v1/service-tickets/:id/operation`, com o `CreateOperationDto` oficial.

`POST /api/v1/auth/login` aceita `channel: PLATFORM|OPERATOR`. Perfil incompatível recebe
`403 AUTH_LOGIN_CHANNEL_FORBIDDEN`. Erros adicionais: 401 de credencial/token, 403 de troca de
senha, 404, 409 de chamado já convertido e 400 de validação.

## Cancelamento de Operation

### `POST /api/v1/operations/:id/cancellation`

Somente o OPERATOR primário da Operation ainda não concluída.

```json
{
  "reason": "Cliente não se encontrava no local",
  "technicalSignatureId": "uuid",
  "customerSignatureData": "data:image/png;base64,...",
  "customerSignerName": "Nome opcional",
  "customerSignerRole": "Responsável",
  "customerSignedAt": "2026-08-02T14:30:00.000Z",
  "photos": [{ "dataUrl": "data:image/jpeg;base64,...", "caption": "Local fechado" }]
}
```

Assinatura do cliente e fotos são opcionais; assinatura técnica própria ativa e motivo são
obrigatórios. Até seis evidências PNG/JPEG de 5 MiB.

### `PATCH /api/v1/operations/:id/cancellation/reschedule`

OWNER/MANAGER. Reabre a mesma Operation e o mesmo Assignment.

```json
{ "assignedTo": "uuid", "scheduledFor": "2026-08-05T13:00:00.000Z", "notes": "Nova visita" }
```

### `PATCH /api/v1/operations/:id/cancellation/approve`

OWNER/MANAGER. Confirma definitivamente o cancelamento. Payload opcional: `{ "notes": "..." }`.

`GET /operations?status=CANCELED` inclui cancelamentos definitivos e solicitações `REQUESTED`.
As respostas de Operation incluem `cancellations[]` sanitizado, sem assinatura binária,
`storageKey` ou paths.

## Compatibilidade de migrations

As migrations recentes são aditivas e não removem contratos:

- `BudgetItem.source` possui default `MANUAL` para clientes e registros anteriores.
- `CustomerAddress.referencePoint` é nullable.
- A reconciliação PMOC não altera IDs, relacionamentos ou payloads; apenas corrige projeções de
  conclusão derivadas.

## Endereços — ponto de referência

`POST /api/v1/customers/:id/addresses` e
`PATCH /api/v1/customers/:id/addresses/:addressId` aceitam o campo aditivo:

```json
{
  "referencePoint": "Entrada pelo portão lateral"
}
```

- Campo opcional; `null`/ausência significam não informado.
- String sanitizada com máximo de 180 caracteres.
- Respostas de CustomerAddress e Operations que incluem `address` retornam o mesmo campo.
- Complemento e ponto de referência são operacionais e não compõem contratos documentais.

## Refinamento PMOC e Budget

`overview.equipmentExecutions[]` em `GET /api/v1/pmoc/:id` inclui:

```json
{
  "lastExecutionNumber": 1,
  "lastExecutionDate": "2026-07-15T15:00:00.000Z",
  "nextExecutionNumber": 2,
  "nextExecutionDate": "2026-08-15T12:00:00.000Z",
  "executionStatus": "UP_TO_DATE"
}
```

`executionStatus`: `NOT_STARTED`, `SCHEDULED`, `IN_PROGRESS`, `UP_TO_DATE`, `OVERDUE`,
`ATTENTION` ou `COMPLETED`.

`items[]` de `POST/PATCH /api/v1/budgets` aceita `source?: MANUAL | CATALOG`.
O padrão retrocompatível é `MANUAL`. `CATALOG` só é aceito para `MATERIAL` e o backend força todos
os valores comerciais do item para zero.

## Catálogos de equipamentos e materiais

Os contratos existentes de `/api/v1/technical-catalogs` aceitam dois tipos adicionais:

- `EQUIPMENT_TYPE`
- `BUDGET_MATERIAL_DESCRIPTION`

CRUD, paginação, ordenação, soft delete, RBAC e auditoria permanecem iguais aos demais catálogos.

`POST /api/v1/equipments` e `PATCH /api/v1/equipments/:id` aceitam:

```json
{
  "equipmentTypeCatalogId": "uuid",
  "type": "OTHER"
}
```

- `equipmentTypeCatalogId` deve apontar para item ativo do tipo `EQUIPMENT_TYPE`.
- `type` tornou-se opcional quando o catálogo é informado.
- Tipos V1 são derivados pela tag de compatibilidade; tipos personalizados persistem `OTHER` no
  enum legado.
- Respostas de equipamentos incluem `equipmentTypeCatalog` com `id`, `title`, `active`,
  `deletedAt` e `tags`.
- Equipamentos vinculados continuam retornando o título mesmo após soft delete do catálogo.

Não houve alteração no payload de Budget: a descrição selecionada é enviada em
`items[].description`.

## Operações — campos operacionais aditivos

`POST /api/v1/operations` aceita, adicionalmente:

```json
{
  "serviceValue": 1350.00,
  "inspectedEquipments": [
    {
      "equipmentId": "uuid",
      "manufacturer": "Carrier",
      "model": "Ecosplit",
      "capacity": "20 TR"
    }
  ]
}
```

- `serviceValue`: opcional, `0..999999999.99`, máximo de duas casas decimais e permitido somente a
  OWNER/MANAGER. OPERATOR recebe `403 OPERATION_SERVICE_VALUE_FORBIDDEN`.
- Marca, modelo e capacidade são opcionais no contrato. Quando o equipamento já possui o campo, o
  valor cadastrado é preservado.
- `PATCH /api/v1/operations/:id` aceita os mesmos campos técnicos em `inspectedEquipments`. Um
  OPERATOR só pode informar IDs originalmente vinculados à operação que lhe pertence.
- Respostas autorizadas de Operation/Assignment incluem `serviceValue`, quando informado.
- Nenhum contrato documental contém `serviceValue`.

## PMOC — ciclos independentes por equipamento

Campos aditivos em `GET /api/v1/pmoc` e `GET /api/v1/pmoc/:id`:

```json
{
  "plannedExecutionCount": 12,
  "operationalStatus": "OVERDUE",
  "overview": {
    "expectedExecutions": 12,
    "expectedEquipmentExecutions": 48,
    "completedExecutions": 37,
    "remainingExecutions": 11,
    "coverageEnded": true,
    "hasOpenExecutions": true,
    "equipmentExecutions": [{
      "equipmentId": "uuid",
      "expectedExecutions": 12,
      "completedExecutions": 10,
      "remainingExecutions": 2,
      "nextExecutionNumber": 11,
      "hasOpenExecutions": true,
      "coverageEnded": true
    }]
  }
}
```

`PmocExecutionRequest` inclui `equipmentExecutionNumber`, número visual reiniciado por equipamento.
`executionNumber` permanece como identidade histórica global.

`POST /api/v1/pmoc/:id/execution-requests` reutiliza solicitação aberta do mesmo equipamento.
Quando o limite é atingido, retorna `409 PMOC_EXECUTION_LIMIT_REACHED`.

Estados aditivos: `OVERDUE` significa cobertura encerrada com pendências; `COMPLETED` significa
cobertura encerrada com todos os ciclos de todos os equipamentos concluídos.

## Assinatura institucional vinculada ao responsável técnico

### `POST /api/v1/signatures`

### `PATCH /api/v1/signatures/:id`

Campo aditivo:

```json
{
  "userId": "uuid-de-um-owner-ativo"
}
```

`userId` é opcional e pode ser `null`. Quando informado, deve identificar um `OWNER` ativo e não
removido. Cada OWNER pode possuir uma única assinatura vinculada; diferentes usuários OWNER podem
possuir assinaturas distintas. Violações retornam `400 USER_NOT_FOUND` ou `409 USER_CONFLICT`.

Os endpoints PMOC existentes permanecem inalterados. O cliente mobile combina:

1. `GET /api/v1/pmoc?active=true`;
2. `GET /api/v1/pmoc/:id`;
3. `GET /api/v1/pmoc/:id/execution-requests`;
4. `POST /api/v1/pmoc/:id/execution-requests` com `equipmentId`;
5. `GET /api/v1/pmoc/execution-requests/:id/prefill`;
6. `POST /api/v1/pmoc/execution-requests/:id/generate-work-order`;
7. endpoints oficiais do Document Engine para salvar, renderizar e baixar.

## Criação do PMOC somente como configuração

### `POST /api/v1/pmoc`

```json
{
  "configurationOnly": true,
  "customerId": "uuid",
  "defaultAddressId": "uuid",
  "equipmentId": "uuid",
  "equipmentIds": ["uuid"],
  "scopeCatalogIds": ["uuid"],
  "serviceTypes": ["PREVENTIVA", "CORRETIVA"],
  "periodicity": "MONTHLY",
  "generationMode": "MANUAL",
  "defaultTechnicianId": "uuid-do-owner",
  "signatureOverrideId": "uuid-da-assinatura-do-owner",
  "responsibleTechnician": "Nome do responsável",
  "startDate": "2026-08-01",
  "endDate": "2027-08-01"
}
```

Resposta aditiva relevante:

```json
{
  "executionRequests": [],
  "lastReservedExecutionNumber": 0,
  "nextExecutionDate": "2026-08-01T00:00:00.000Z",
  "nextGenerationDate": null
}
```

Nenhuma execução, OS ou documento é criado. Relacionamentos inválidos retornam `400
PMOC_INVALID_RELATIONSHIP`; a confirmação de cobertura ativa mantém o contrato `409` existente.

## Métricas de operações por cliente

### `GET /api/v1/operations/stats?customerId={uuid}`

`customerId` é opcional e validado como UUID v4. Sem o parâmetro, preserva o contrato global.

```json
{
  "total": 12,
  "byStatus": {
    "DRAFT": 1,
    "PENDING": 2,
    "IN_PROGRESS": 3,
    "REVIEW": 1,
    "COMPLETED": 5,
    "CANCELED": 0
  }
}
```

O RBAC e o ownership do ator são aplicados antes da agregação.

## Recibo originado por venda — prefill enriquecido

### `GET /api/v1/sales/:id/receipt-prefill`

Resposta aditiva:

```json
{
  "origin": "SALE",
  "saleId": "uuid",
  "receiptNumber": "REC-V000007",
  "issuedAt": "2026-07-23T12:00:00.000Z",
  "amount": "1350.00",
  "service": "Compressor",
  "description": "1.000 UN — Compressor\nObservações: entrega na unidade principal",
  "warrantyDays": 90,
  "customer": {
    "id": "uuid",
    "name": "Vectra Consultoria e Serviços LTDA",
    "tradeName": "Vectra Consultoria e Serviços",
    "cpf": null,
    "cnpj": "12345678000190"
  },
  "address": null
}
```

Somente venda `COMPLETED`. `description` sempre contém os itens snapshotados e, quando presentes,
as observações da venda. Os campos existentes foram preservados; `origin`, `cpf` e `cnpj` são
aditivos.

## PMOC → Ordem de Serviço — prefill e geração revisada

### `GET /api/v1/pmoc/execution-requests/:id/prefill`

OWNER/MANAGER recebem um `CreateOperationPayload` pronto para revisão. O payload contém cliente,
endereço, equipamento principal compatível, todos os `inspectedEquipments`, tipos de serviço,
operador padrão, agenda, textos e checklist do plano.

Além do `checklist` compatível, `maintenanceChecklist` contém um item por procedimento e por
equipamento coberto, inicialmente com `executed: false` e `result: "NO"`.

### `POST /api/v1/pmoc/execution-requests/:id/generate-work-order`

```json
{
  "operation": {
    "customerId": "uuid",
    "equipmentId": "uuid",
    "inspectedEquipments": [{ "equipmentId": "uuid", "sector": "Sala técnica" }],
    "type": "PREVENTIVA",
    "documentType": "PMOC",
    "operatorId": "uuid",
    "scheduledFor": "2026-08-01T12:00:00.000Z",
    "checklist": [{ "label": "Inspecionar filtros", "done": false }],
    "observations": "Orientações para o atendimento"
  }
}
```

O backend sempre sobrescreve a identidade do cliente, cobertura de equipamentos, vínculo PMOC,
data da execução e tipo documental com os dados autoritativos da Execution Request. A lista
revisada em `checklist` é materializada como checklist estruturado de campo. Informar `operatorId`
válido cria a Assignment pelo fluxo oficial.

Respostas existentes e erros de estado/adiantamento permanecem inalterados. Não houve novo endpoint.

## Checklists oficiais — RVT e PMOC

`POST/PATCH /api/v1/operations` preserva os campos existentes:

```json
{
  "maintenanceType": "WEEKLY",
  "maintenanceChecklist": [
    { "maintenanceType": "WEEKLY", "description": "Inspecionar filtros", "executed": true, "result": "YES" },
    { "maintenanceType": "SEMIANNUAL", "description": "Higienizar serpentinas", "executed": false, "result": "NO" }
  ]
}
```

Para RVT, os tipos oficiais V1 são `WEEKLY` e `SEMIANNUAL`; os dois grupos devem ser enviados, e `maintenanceType` identifica o realizado.

`POST /api/v1/pmoc` e `PATCH /api/v1/pmoc/:id` aceitam `checklistCatalogIds: UUID[]` e `includeChecklistInOperations: boolean`. A projeção retorna `checklists[]` ordenado. Os IDs devem ser itens ativos `CHECKLIST`, da instalação, aplicáveis a `WORK_ORDER` ou `GENERAL`.

## Gestão — Execuções dos Operadores

Autorização em todos os endpoints: `OWNER | MANAGER`. A fonte do executor é sempre `Assignment.assignedTo`.

### `GET /api/v1/operator-executions`

Query: `month=YYYY-MM`, `page` (1+), `limit` (1–50) e `search` (nome, username ou cargo).

Resposta `200`: `period`, `kpis`, `items` e `pagination`. Cada item contém dados públicos do operador e `metrics`: `total`, `completed`, `pending`, `inProgress`, `overdue`, `canceled`, `completionRate`, `averageDurationMinutes` e `lastCompletedAt`.

### `GET /api/v1/operator-executions/:operatorId`

Query: `month=YYYY-MM`. Retorna `operator`, `period` e `metrics`. UUID inválido retorna `400`; usuário inexistente ou que não seja OPERATOR retorna `404 USER_NOT_FOUND`.

### `GET /api/v1/operator-executions/:operatorId/operations`

Query: `month=YYYY-MM`, `view=HISTORY|AGENDA`, `status`, `page` e `limit` (máx. 100). `HISTORY` considera atribuição, agenda ou conclusão na competência; `AGENDA` considera `Operation.scheduledFor`. Retorna cliente, equipamento, tipo documental, datas e estado oficial de Operation/Assignment, sem dados financeiros.

Definições: pendentes = `ASSIGNED|ACCEPTED`; em execução = `STARTED|PAUSED`; concluídos usam `Assignment.completedAt` na competência; atrasados são atribuições abertas com agenda anterior ao instante atual. A taxa é `concluídos / (concluídos + pendentes + em execução)`.

## Operator — criação e conclusão de atendimentos

### `POST /api/v1/operations`

Para `OPERATOR`, `documentType` aceita somente:

- `WORK_ORDER`;
- `TECHNICAL_REPORT`.

O status inicial deve ser `DRAFT`. Outros tipos retornam `403 OPERATION_OPERATOR_DOCUMENT_TYPE_FORBIDDEN`; tentativa de iniciar em outro status retorna `409 OPERATION_INVALID_TRANSITION`. OWNER/MANAGER preservam os contratos de criação existentes.

### `PATCH /api/v1/assignments/:id/complete`

| Documento solicitado | Status da Operation | Resultado |
| --- | --- | --- |
| `WORK_ORDER` | `COMPLETED` | Conclusão definitiva, lifecycle/maintenance sincronizados e gestão notificada |
| `TECHNICAL_REPORT` | `COMPLETED` | Conclusão definitiva, lifecycle/maintenance sincronizados e gestão notificada |
| Demais tipos atribuídos | `REVIEW` | Mantém revisão da gestão |

### `POST /api/v1/documents/:documentId/handoff/finalize`

O `OPERATOR` pode usar o endpoint somente quando o documento é OS/RVT, pertence à sua Assignment, foi enviado e a Operation está `COMPLETED`. O Handoff passa a `READY`. Demais tipos retornam `403 DOCUMENT_HANDOFF_NOT_ALLOWED`.

### `POST /api/v1/documents/:documentId/render`

O `OPERATOR` pode renderizar somente OS/RVT com Handoff `READY`, Operation `COMPLETED` e `operatorId` igual ao usuário autenticado. O payload de sucesso permanece o contrato oficial do Document Engine. Download continua em `GET /api/v1/documents/:documentId/download`.

## PMOC — cobertura ativa do cliente

### `GET /api/v1/pmoc/active-coverage?customerId={uuid}`

Autorização: `OWNER` ou `MANAGER`.

Resposta `200`:

```json
{
  "hasActiveCoverage": true,
  "checkedAt": "2026-07-22T12:00:00.000Z",
  "conflicts": [
    {
      "id": "uuid",
      "number": 14,
      "name": "PMOC Cliente",
      "coverage": "2026",
      "startDate": "2026-01-01T00:00:00.000Z",
      "endDate": "2026-12-31T00:00:00.000Z",
      "operationalStatus": "ACTIVE",
      "equipmentCount": 4
    }
  ]
}
```

### Confirmação na criação

`POST /api/v1/pmoc` aceita o campo aditivo e opcional:

```json
{ "confirmActiveCoverage": true }
```

Quando há cobertura ativa e o campo não é `true`, a criação não é persistida e retorna `409`:

```json
{
  "success": false,
  "error": {
    "code": "PMOC_ACTIVE_COVERAGE_CONFIRMATION_REQUIRED",
    "message": "Já existe cobertura PMOC ativa para este cliente. Confirme para continuar.",
    "details": {
      "customerId": "uuid",
      "conflicts": []
    }
  }
}
```

Após a confirmação, o contrato de sucesso da criação permanece inalterado.

## ORBIT_SECURITY_FIX01 — política transversal de ownership

Não houve mudança de URL, request ou shape de sucesso. Para usuário `OPERATOR`, todos os contratos
operacionais abaixo são condicionados ao `Assignment` vigente do próprio usuário:

- `/operations`, `/operations/stats`, `/operations/:id` e `/operations/photos/:photoId`;
- `/maintenance-plans/:id/executions`, `/maintenance-executions/:id` e consultas upcoming/stats;
- `/documents`, preview por Operation/documento, download, Handoff, assinatura e histórico;
- `/asset-lifecycle`, detalhe, timeline/métricas por equipamento e anexos;
- `/operations/:id/materials`, movimentações de estoque relacionadas e exports de operações/documentos.

Listagens retornam somente registros autorizados e mantêm paginação sobre o conjunto filtrado no
banco. Acesso direto a recurso existente sem Assignment válido retorna:

```http
HTTP/1.1 403 Forbidden
```

```json
{
  "success": false,
  "error": {
    "code": "FORBIDDEN",
    "message": "Operator does not have an active Assignment for this resource",
    "details": {}
  }
}
```

Estados aceitos: `ASSIGNED`, `ACCEPTED`, `STARTED`, `PAUSED`, `COMPLETED`. Assignments
`REJECTED`/`CANCELED`, documentos sem vínculo com Operation e IDs pertencentes a outro operador são
negados com `403`. OWNER/MANAGER/VIEWER mantêm o RBAC previamente documentado.

## DC-05 — Recibo / Garantia

`POST /api/v1/operations` e `PATCH /api/v1/operations/:id` aceitam os campos aditivos:

```json
{
  "documentType": "RECEIPT",
  "receiptNumber": "REC-000125",
  "receiptIssuedAt": "2026-07-18",
  "receiptAmount": 1275.90,
  "receiptAmountInWords": "um mil duzentos e setenta e cinco reais e noventa centavos",
  "receiptDescription": "Higienização e revisão do sistema",
  "receiptWarrantyDays": 90,
  "receiptDeclaration": "Texto final editável da declaração."
}
```

`receiptNumber` omitido usa `REC-<operação>`; garantia nula significa “Sem garantia”. Preview,
seleção da assinatura técnica, revisão, render e download reutilizam os endpoints oficiais de
`/documents`. O download é PDF binário autenticado.

Novos Recibos utilizam `receiptDescription` como única fonte descritiva no Wizard e no documento.
`receiptService` permanece aceito somente para compatibilidade com registros históricos e não é
mais enviado pela Central de Relatórios.


## PMOC — evidências e assinaturas no wizard

Nenhum endpoint novo. Os fluxos Platform e Operator reutilizam:

- `PATCH /api/v1/operations/:id` para adicionar fotos oficiais à execução;
- `GET /api/v1/operations/photos/:photoId` para miniaturas autenticadas;
- `POST /api/v1/documents/handoffs` para obter/criar idempotentemente o Handoff PMOC;
- `PATCH /api/v1/documents/:documentId/handoff/customer-signature` para coletar ou substituir;
- `GET /api/v1/documents/:documentId/handoff/customer-signature` para a imagem autenticada.

O Handoff retorna `customerSignature.collectedBy`, `collectedAt`, `technicalSignature` e
`operation.operator`. Nenhuma resposta expõe `storageKey`, path ou Base64 de assinatura.

## PMOC UX-02.1 — evidências, política e PDF binário

### `GET /api/v1/documents/configuration/types/PMOC`

Roles: `OWNER`, `MANAGER`, `VIEWER` e `OPERATOR`. Para OPERATOR, somente `PMOC` é permitido;
qualquer outro tipo retorna `403 FORBIDDEN`. A resposta mantém o envelope padrão e expõe somente
metadados públicos (`id`, `name`, `title`, `professionalCouncil`, `department`, `active`,
`hasImage`). `imageStorageKey`, caminhos e binários não fazem parte dessa projeção.

### Evidências da execução PMOC

`PATCH /api/v1/operations/:id` continua aceitando `photos[]` com `dataUrl` PNG/JPEG e `caption`
opcional. Cada arquivo deve ter no máximo 5 MiB e possuir assinatura binária compatível. O endpoint
pode salvar menos de quatro fotos durante o preenchimento parcial.

As seguintes ações exigem pelo menos quatro fotos persistidas quando a Operation pertence a PMOC:

- `PATCH /api/v1/assignments/:id/complete`;
- `PATCH /api/v1/operations/:id` com `status: "COMPLETED"`;
- `POST /api/v1/documents/operations/:operationId/PMOC/render`;
- `POST /api/v1/documents/:documentId/render` para documento PMOC.

Falha:

```json
{
  "success": false,
  "error": {
    "code": "PMOC_EVIDENCE_REQUIRED",
    "message": "Registre pelo menos 4 imagens do procedimento antes de concluir",
    "details": { "required": 4, "current": 0 }
  }
}
```

### `GET /api/v1/documents/:documentId/download`

### `GET /api/v1/budgets/:id/download`

Resposta de sucesso é binária, sem envelope JSON:

- `Content-Type: application/pdf`;
- `Content-Disposition: attachment; filename="<numero>.pdf"`;
- `Content-Length` definido;
- corpo: bytes do PDF.

Erros continuam no envelope oficial (`404 DOCUMENT_NOT_FOUND`, `409 DOCUMENT_DOWNLOAD_NOT_READY`,
`409 DOCUMENT_STALE`, `401/403`). O download passa pelo Document Engine e nunca expõe Storage.

## PMOC UX-02 — nome e escopo estruturado

### `GET /api/v1/pmoc/name-suggestion?customerId=:uuid`

Roles: `OWNER`, `MANAGER`.

```json
{
  "success": true,
  "data": {
    "name": "PMOC · Hospital Santa Maria · PMOC-000018",
    "provisionalNumber": 18
  }
}
```

O número é uma indicação de UX. Sem personalização, `POST /pmoc` deve omitir `name`; o backend
grava o nome definitivo após o autoincremento transacional.

### `POST /api/v1/pmoc` e `PATCH /api/v1/pmoc/:id`

Campo aditivo: `scopeCatalogIds: string[]` (1 a 50 UUIDs únicos). Todos devem ser `PLAN_SCOPE`,
ativos, não removidos e da organização. A resposta adiciona `scopes[].technicalCatalog` e mantém
`coverage` como snapshot. Item inválido retorna `400 TECHNICAL_CATALOG_NOT_FOUND`.

### `PATCH /api/v1/pmoc/execution-requests/:id/reschedule`

Contrato preservado. Altera somente a request informada e sua `MaintenanceExecution`; mantém
`executionNumber`, periodicidade e demais execuções.

## PMOC Foundation — Bloco 3

### Dashboard e calendário

`GET /api/v1/pmoc/stats?from=<ISO-8601>&to=<ISO-8601>` mantém os campos anteriores e adiciona:

```json
{
  "activePmocs": 4,
  "pausedPmocs": 1,
  "expiredPmocs": 1,
  "executionsThisMonth": 8,
  "completedExecutions": 21,
  "pendingExecutions": 5,
  "cancelledExecutions": 1,
  "failedExecutions": 0,
  "calendar": { "from": "ISO", "to": "ISO", "items": [] },
  "upcoming": [],
  "recent": []
}
```

Cada item contém `pmocPlanId`, número/nome do plano, cliente, equipamentos, `executionNumber`,
origem, status, datas, operador, técnico, OS, documento e `indicator`. Indicadores oficiais:
`ON_TIME`, `DUE_SOON`, `OVERDUE`, `COMPLETED`, `CANCELLED`, `FAILED`. Período máximo: 370 dias;
acima disso retorna 400. O calendário retorna no máximo 500 registros.

### Overview do plano

`GET /api/v1/pmoc` e `GET /api/v1/pmoc/:id` adicionam `overview`:

```json
{
  "expectedExecutions": 12,
  "completedExecutions": 8,
  "remainingExecutions": 4,
  "pendingExecutions": 1,
  "cancelledExecutions": 1,
  "failedExecutions": 0,
  "overdueExecutions": 0,
  "completionPercentage": 80,
  "averageDelayDays": 0.5,
  "lastExecutionDate": "ISO",
  "lastOperation": { "id": "uuid", "number": 125, "status": "COMPLETED" },
  "lastDocument": { "id": "uuid", "number": "PMOC-000125", "status": "READY", "renderedAt": "ISO" },
  "health": { "code": "GOOD", "label": "Boa", "tone": "success", "score": 82 }
}
```

`GET /api/v1/pmoc/:id/history` continua sendo array append-only e passa a incluir `source`
(`PMOC`, `ASSIGNMENT`, `DOCUMENT`, `AUDIT`) e, quando aplicável, `document`. Eventos adicionais
de projeção: `ASSIGNMENT_*`, `DOCUMENT_RENDERED` e `CLIENT_SIGNED`.

## PMOC Foundation — Bloco 2

Campos aditivos aceitos por `POST /api/v1/pmoc` e `PATCH /api/v1/pmoc/:id`:

```json
{
  "name": "PMOC Hospital Santa Clara",
  "defaultAddressId": "uuid opcional",
  "defaultOperationType": "PREVENTIVA",
  "defaultEstimatedDurationMinutes": 120,
  "defaultOperationObservations": "Acessar a casa de máquinas pela portaria técnica",
  "applyDefaultsToPendingExecutions": true
}
```

`applyDefaultsToPendingExecutions` é exclusivo do PATCH e nunca é persistido. Quando verdadeiro,
somente snapshots de solicitações `PENDING` e `FAILED` recebem os novos responsáveis. Quando
omitido/falso, a alteração vale apenas para solicitações futuras.

As respostas de plano adicionam `defaultAddress`, `defaultOperationType`,
`defaultEstimatedDurationMinutes` e `defaultOperationObservations`. As solicitações adicionam
`plannedOperatorId`, `plannedTechnicianId`, `plannedOperator` e `plannedTechnician`.

### Reagendar solicitação PMOC

`PATCH /api/v1/pmoc/execution-requests/:id/reschedule` — OWNER/MANAGER.

```json
{ "scheduledFor": "2026-08-20T12:00:00.000Z", "notes": "Reagendada com o cliente" }
```

Somente `PENDING` ou `FAILED`, dentro da cobertura do plano. A resposta é a mesma
`PmocExecutionRequest`, preservando `id` e `executionNumber`. O backend sincroniza a
`MaintenanceExecution`; não cria nova solicitação. Erros possíveis: 400 data/cobertura inválida,
404 solicitação inexistente, 409 estado ou data conflitante, 403 sem papel autorizado.

## PMOC Foundation — Bloco 1.1

Extensão aditiva das respostas de PMOC:

```json
{
  "lastReservedExecutionNumber": 3,
  "lastGeneratedExecutionNumber": 2,
  "lastExecutionDate": "2026-02-16T14:00:00.000Z",
  "nextExecutionDate": "2026-03-15T00:00:00.000Z",
  "nextGenerationDate": "2026-03-15T00:00:00.000Z",
  "lastSchedulerRun": "2026-03-15T00:01:00.000Z",
  "lastSchedulerStatus": "SUCCESS",
  "lastSchedulerError": null,
  "lastSuccessfulGeneration": "2026-02-15T00:01:00.000Z"
}
```

`lastSchedulerStatus`: `NEVER_RUN | RUNNING | SUCCESS | PARTIAL_FAILURE | FAILED`.

Toda `PmocExecutionRequest` inclui `executionNumber`, `executionYear`, `generatedOperationId` e
`generatedAt`. O número é reservado pelo backend, monotônico por PMOC e não é aceito em requests.
Cancelamento e retry preservam o número. `operationId` permanece como alias compatível e aponta
para a mesma Operation quando a OS é gerada.

`GET /api/v1/pmoc/:id/history` preserva o array de eventos e adiciona `execution` aos eventos
associados, com `executionNumber`, `executionYear`, `workOrderNumber`, `status`, `scheduledFor`,
`generatedAt`, `executedAt`, `operator` e `responsibleTechnician`.

Não houve endpoint novo nem alteração em payload de escrita.

## PMOC Foundation — Bloco 1

Extensão aditiva de `POST /api/v1/pmoc` e `PATCH /api/v1/pmoc/:id`:

```json
{
  "coverage": "Cobertura técnica do plano",
  "periodicity": "QUARTERLY",
  "generationMode": "MANUAL",
  "defaultOperatorId": "uuid opcional",
  "defaultTechnicianId": "uuid opcional",
  "signatureOverrideId": "uuid opcional",
  "recurrenceRule": null
}
```

Periodicidades: `WEEKLY`, `BIWEEKLY`, `MONTHLY`, `BIMONTHLY`, `QUARTERLY`,
`FOUR_MONTHLY`, `SEMIANNUAL`, `YEARLY`, `CUSTOM`. Apenas `CUSTOM` exige
`recurrenceRule`; payloads legados que enviam somente a regra continuam aceitos.

Endpoints:

- `GET /api/v1/pmoc/:id/execution-requests?page=1&limit=20&status=PENDING` — paginação oficial.
- `POST /api/v1/pmoc/:id/execution-requests` — body opcional `{ scheduledFor, notes }`.
- `GET /api/v1/pmoc/execution-requests/:id` — detalhe rastreável.
- `GET /api/v1/pmoc/execution-requests/:id/prefill` — payload do wizard oficial (OWNER/MANAGER).
- `POST /api/v1/pmoc/execution-requests/:id/generate-work-order` — body
  `{ "operation": CreateOperationPayload }` (OWNER/MANAGER).
- `PATCH /api/v1/pmoc/execution-requests/:id/cancel` — somente PENDING/FAILED.
- `GET /api/v1/pmoc/:id/history` — histórico imutável.
- `POST /api/v1/pmoc/scheduler/run?limit=25` — retorna
  `{ recovered, attempted, generated, failed, manualPending }`.

O backend sobrescreve cliente, equipamento primário, tipo preventivo e data com valores do PMOC.
Erros: `PMOC_EXECUTION_REQUEST_NOT_FOUND`, `PMOC_EXECUTION_REQUEST_INVALID_STATE`,
`PMOC_EXECUTION_REQUEST_CONFLICT` e `PMOC_GENERATION_FAILED`. Falha mantém `operationId: null`.

## DC-03.1 — responsabilidade e equipamentos do TECHNICAL_OPINION

Extensão aditiva de `POST /api/v1/operations` e `PATCH /api/v1/operations/:id`:

```json
{
  "technicalOpinionResponsible": "Marina Albuquerque",
  "technicalOpinionCrea": "CREA-PE 123456",
  "inspectedEquipments": [
    {
      "equipmentId": "uuid",
      "sector": "Sala 01",
      "systemType": "Unidade Interna e Externa",
      "currentSituation": "Unidade externa queimada"
    }
  ]
}
```

Limites: responsável 180, registro 100, tipo de sistema 180, local 160 e situação 500 caracteres.
Os campos são sanitizados. O backend valida UUID único, equipamento ativo e pertencente ao mesmo
cliente. `OperationDetail` retorna `technicalOpinionResponsible`, `technicalOpinionCrea`,
`systemTypeSnapshot` e `currentSituationSnapshot`.

O Blueprint retorna a tabela com `Nº`, `MODELO / CAPACIDADE`, `TIPO DE SISTEMA`,
`LOCAL DE INSTALAÇÃO` e `SITUAÇÃO ATUAL`. A seção Solicitante contém razão social, documento,
contato e endereço sem criar payload paralelo.

## DC-03 — conteúdo oficial de TECHNICAL_OPINION

`POST /api/v1/operations` e `PATCH /api/v1/operations/:id` aceitam aditivamente:

```json
{
  "technicalOpinionObjective": "Objetivo técnico (até 20.000 caracteres)",
  "technicalOpinionConditions": "Uma condição observada por linha (até 20.000 caracteres)",
  "technicalOpinionAnalysis": "Análise em múltiplos parágrafos (até 30.000 caracteres)",
  "technicalOpinionConclusion": "Conclusão técnica (até 20.000 caracteres)",
  "inspectedEquipments": [
    {
      "equipmentId": "uuid",
      "sector": "Sala de máquinas",
      "systemType": "Unidade Interna e Externa",
      "currentSituation": "Operação comprometida"
    }
  ]
}
```

Os campos são opcionais, sanitizados e retornados em `OperationDetail`. Permanecem:

- `GET /documents/operations/:operationId/TECHNICAL_OPINION/preview`;
- `POST /documents/operations/:operationId/TECHNICAL_OPINION/render`;
- `GET /documents/:documentId/preview`;
- `POST /documents/:documentId/render`;
- `GET /documents/:documentId/download`;
- `GET /documents?type=TECHNICAL_OPINION`.

Ordem de `sections`: `technical-opinion-identification` →
`technical-opinion-requester` → `technical-opinion-objective` →
`technical-opinion-equipments` → `technical-opinion-site-conditions` →
`technical-opinion-analysis` → `technical-opinion-conclusion` → `signature`, quando
configurada.

Não são emitidos checklist, materiais, fotos, QR, timeline, Assignment ou documentos relacionados.
A tabela usa `Nº`, `MODELO / CAPACIDADE`, `TIPO DE SISTEMA`, `LOCAL DE INSTALAÇÃO` e
`SITUAÇÃO ATUAL`.

## WORK_ORDER — origem e Blueprint consolidados

Nenhum endpoint novo foi criado. Para uma OS independente, o frontend usa `POST /api/v1/operations`
com `status: "DRAFT"`; a transação existente cria o `OperationDocument` WORK_ORDER. Para uma
Operation existente, permanecem os endpoints oficiais de preview/render/download.

O payload pode usar `equipmentId` como equipamento primário e `inspectedEquipments[]` para a tabela
completa. `reportedIssue`, `serviceDescription`, `checklist`, `observations`, `photos` e
`signatureData` permanecem nos contratos existentes.

Ordem de `sections`:

`work-order-identification` → `work-order-customer` → `work-order-inspected-equipments` →
`work-order-reported-issue` → `work-order-execution` →
`observations-observacoes-e-resultado-operacional` (quando houver) →
`photos-evidencias-fotograficas` (quando houver) → `signature` (conforme template).

`work-order-execution` agrega narrativa e checklist. Evidências usam o componente aditivo:

```json
{
  "kind": "imageGallery",
  "columns": 2,
  "images": [
    {
      "sourceId": "uuid",
      "caption": "Painel após manutenção",
      "mimeType": "image/jpeg",
      "fileSize": 123456,
      "image": { "mimeType": "image/jpeg", "fileSize": 123456, "contentBase64": "..." }
    }
  ]
}
```

Não são emitidas seções de materiais ou documentos relacionados na WORK_ORDER.

## WORK_ORDER — identificação textual do equipamento

Os endpoints existentes permanecem iguais. No Blueprint de `WORK_ORDER`, a seção `equipment`
contém `metadata` com `Código QR: <Equipment.qrCode>` e não contém mais componente `qrCode` com
imagem Base64. O identificador continua aceito por `GET /equipments/lookup/:qrCode`.

## TECHNICAL_REPORT — ordem oficial do Blueprint

Os endpoints existentes de preview/render não mudaram. `sections` agora é devolvido nesta ordem:

`technical-report-identification` → `technical-report-customer` →
`technical-report-location` → `technical-report-inspected-equipments` →
`technical-report-reference-period` → `maintenance-checklist-<periodicidade>` →
`visit-objective` → `visit-diagnosis` → `visit-activities` →
`checklist-checklist-complementar` → `visit-recommendations` →
`observations-observacoes-finais` → `signature` (quando configurada).

A tabela de equipamentos possui `ITEM`, `SETOR`, `MARCA`, `MODELO` e `CAPACIDADE`. Para este tipo,
não são emitidas as seções de QR individual, materiais, fotos ou documentos relacionados. Campos
opcionais sem dados continuam seguindo a omissão já prevista no contrato.

## Refinamento visual do Blueprint

`footer.content` não inclui versão técnica do Blueprint. A propriedade raiz `version` permanece no
contrato exclusivamente para compatibilidade interna do Document Engine. A logo do header é
centralizada verticalmente no Preview e na renderização oficial.

## DC-02 — conteúdo técnico da Operation e TECHNICAL_REPORT

`POST /api/v1/operations` e `PATCH /api/v1/operations/:id` aceitam, de forma aditiva:

```json
{
  "reportedIssue": "Objetivo da visita (até 10.000 caracteres)",
  "technicalDiagnosis": "Diagnóstico/situação encontrada (até 20.000 caracteres)",
  "serviceDescription": "Atividades executadas (até 20.000 caracteres)",
  "technicalRecommendations": "Recomendações técnicas (até 20.000 caracteres)",
  "observations": "Observações finais (até 5.000 caracteres)"
}
```

Os campos são opcionais, sanitizados e retornados em `OperationDetail`. Texto pode conter múltiplos
parágrafos e listas iniciadas por `-`, `*`, `•`, `✓`, `✔` ou numeração.

Contratos documentais preservados:

- `GET /documents/operations/:operationId/TECHNICAL_REPORT/preview`;
- `POST /documents/operations/:operationId/TECHNICAL_REPORT/render`;
- `GET /documents/:documentId/preview`;
- `POST /documents/:documentId/render`;
- `GET /documents/:documentId/download`;
- `GET /documents?type=TECHNICAL_REPORT`.

O Blueprint pode retornar `pageBreakAfter` em `technical-report-equipment`; é uma orientação aditiva
para manter a identificação/equipamento na primeira página e iniciar o QR/conteúdo técnico na
seguinte. Nenhum endpoint ou envelope foi alterado.

## Product Backlog Closure 07 — workflows documentais

Não foram criados contratos HTTP novos. A Central orquestra `POST/PATCH /operations`, endpoints de MaintenanceExecution para PMOC, configuração por tipo, preview/render/download e `GET /documents`.

Semântica reutilizada: `reportedIssue` representa objetivo/diagnóstico/referência; `serviceDescription` representa atividades/análise/medições/dados do recebimento; `observations` representa observações/conclusão/pendências. DTOs e limites existentes permanecem inalterados.

## DC-01.2 — Blueprint visual e QR real

`DocumentSection.pageBreakAfter` é um campo aditivo usado pela WORK_ORDER para indicar a quebra
preferencial após Equipamento. Em `SignatureMode.FIXED`, o componente contém exclusivamente as
assinaturas institucionais configuradas; flags de execução não acrescentam placeholders.

O contrato gráfico descrito originalmente foi substituído: `WORK_ORDER` expõe apenas o identificador
em `equipment.metadata`. Outros tipos que ainda utilizam `qrCode` preservam o contrato do componente.

O Blueprint pode retornar `visualStyle` com tokens de cor, tipografia e espaçamento. O campo é
aditivo e retrocompatível. `signature.signatures[]` continua retornando somente a imagem resolvida e
metadados públicos; a assinatura institucional configurada preserva `name`, `title`,
`professionalCouncil` e `department` no texto do componente.

## DC-01 — campos da Work Order

`POST /operations` e `PATCH /operations/:id` aceitam `reportedIssue?: string` (até 10.000) e
`serviceDescription?: string` (até 20.000). Ambos são texto operacional, sanitizado pelo DTO e
utilizado pelo WORK_ORDER Blueprint. Organization aceita opcionalmente `website`, `zipCode`,
`street`, `number`, `complement` e `district` para o cabeçalho/rodapé documental.

Os endpoints de preview/render/download não mudaram.

## Document repository D1 — GET `/api/v1/documents`

Roles: OWNER, MANAGER, OPERATOR, VIEWER; documentos financeiros conservam restrição de OWNER.
Query: `page`, `limit`, `search`, `type`, `status`, `customerId`, `equipmentId`, `operatorId`, `from`,
`to`. Todos os filtros combinam com AND.

Cada item retorna `id`, `number`, `type`, `status`, `origin`, `originId`, `customer`, `equipment`,
`responsible`, `issuedAt`, `renderedAt`, `fileSize`, `version`, `createdAt`, `updatedAt`, dentro do
envelope paginado padrão. Não retorna conteúdo ou chaves de Storage.

Templates aceitam `institutionalSignatureIds: UUID[]`, `executionSignatureClient`,
`executionSignatureTechnician` e `executionSignatureOperator`. Signatures aceitam
`professionalCouncil` e `department` opcionais.

## Product Backlog Closure 06.1 — runtime-confirmed contracts

`GET /operations` e `GET /operations/:id` retornaram em runtime `createdAt` e `scheduledFor`.
`scheduledFor` permanece o campo canônico; `null` significa “Não agendado”.

Preview e render de OS usam o mesmo tipo/template/componentes. Download continua retornando
`409 DOCUMENT_STALE` após mudança semântica e funciona após re-render explícito. O formato HTTP do
PDF não mudou; somente o binário passou a incorporar fonte Unicode e apresentação equivalente.

## Product Backlog Closure 06 — current Work Order contract

Contratos existentes preservados:

- `GET /documents/operations/:operationId/WORK_ORDER/preview` retorna o blueprint atual e
  `metadata.sourceFingerprint`.
- `POST /documents/operations/:operationId/WORK_ORDER/render` sempre reconstrói a fonte atual e
  persiste `renderMetadata.sourceFingerprint`.
- `GET /documents/:documentId/download` retorna `409 DOCUMENT_STALE` quando a fonte atual diverge do
  último render (ou o render legado não possui fingerprint). `error.details.rerenderRequired = true`.
- `PATCH /operations/:id` só conclui depois de persistir a mutation e processar evidências; retorna a
  `OperationDetail` recarregada.

`OperationSummary` e `OperationDetail` mantêm campos temporais distintos:

```json
{
  "createdAt": "2026-07-11T10:00:00.000Z",
  "scheduledFor": "2026-07-12T13:00:00.000Z",
  "startedAt": null,
  "completedAt": null,
  "signedAt": null
}
```

`scheduledFor: null` significa explicitamente que a Operation não está agendada.

## Product Backlog Closure 05 — Document preview/render consistency

Contratos HTTP preservados. Nenhum endpoint novo foi criado e nenhum payload público obrigatório foi
alterado.

Impacto nos contratos existentes do Document Engine:

- `GET /documents/operations/:operationId/:type/preview`
- `POST /documents/operations/:operationId/:type/render`
- `GET /documents/:documentId/preview`
- `POST /documents/:documentId/render`
- `GET /documents/:documentId/download`

Quando a Operation possuir assinatura de execução válida (`signatureData` + `signedAt`) e o tipo
documental aceitar assinatura operacional, o blueprint retornará um componente:

```json
{
  "kind": "signature",
  "mode": "COLLECTED",
  "signatures": [
    {
      "id": "collected-signature",
      "role": "collected",
      "label": "Assinatura do cliente/responsável",
      "name": null,
      "title": null,
      "signedAt": "2026-07-10T12:00:00.000Z",
      "caption": "Assinatura coletada na execução",
      "image": {
        "mimeType": "image/png",
        "fileSize": 1024,
        "contentBase64": "..."
      }
    }
  ]
}
```

Tipos com assinatura operacional automática quando há execução assinada:

- `WORK_ORDER`
- `TECHNICAL_REPORT`
- `REPORT`
- `RECEIPT`

`QUOTE`, `BUDGET`, `PMOC` e `TECHNICAL_OPINION` continuam dependendo apenas da configuração
documental do template.

`Operation.signatureData` na criação continua sendo opcional, mas quando informado deve ser
`data:image/png;base64,...` ou `data:image/jpeg;base64,...`; binários inválidos retornam
`400 OPERATION_PHOTO_INVALID`.

## Product Backlog Closure 05.1 — Operation evidence update

`PATCH /operations/:id` foi estendido, sem novo domínio, para persistir evidências oficiais de uma
Operation já existente.

Payload adicional opcional:

```json
{
  "observations": "Serviço executado conforme checklist.",
  "checklist": [{ "label": "Teste de funcionamento", "done": true, "note": "Operação normal" }],
  "signatureData": "data:image/png;base64,...",
  "signedAt": "2026-07-10T12:00:00.000Z",
  "photos": [
    {
      "dataUrl": "data:image/jpeg;base64,...",
      "caption": "Condensadora após manutenção"
    }
  ]
}
```

Regras:

- `signatureData` aceita apenas PNG/JPEG data URL válido.
- `photos[].dataUrl` aceita apenas PNG/JPEG data URL válido.
- Fotos são armazenadas via StorageProvider e retornam somente metadados públicos.
- `storageKey` nunca é retornado.
- A resposta segue `OperationDetail` existente.

## Conventions

- Base path: `/api/v1`
- Media type JSON: `application/json`
- Upload de assets: `multipart/form-data`
- Datas: ISO 8601 UTC.
- Campos JSON: `camelCase`.
- Toda resposta inclui `X-Request-Id`.
- Endpoints protegidos usam `Authorization: Bearer <accessToken>`.

### Success envelope

```json
{
  "success": true,
  "data": {}
}
```

### Error envelope

```json
{
  "success": false,
  "error": {
    "code": "ERROR_CODE",
    "message": "Human-readable message",
    "details": {}
  }
}
```

Use `error.code` para lógica de cliente. Mensagens podem mudar sem quebra de contrato.

## Common protected errors

| HTTP | Code                       | Condition                              |
| ---- | -------------------------- | -------------------------------------- |
| 401  | `UNAUTHORIZED`             | Bearer token ausente/malformado        |
| 401  | `AUTH_INVALID_TOKEN`       | Access token inválido ou expirado      |
| 401  | `AUTH_SESSION_REVOKED`     | Sessão rotacionada, revogada ou expira |
| 401  | `AUTH_USER_INACTIVE`       | Usuário desativado                     |
| 403  | `FORBIDDEN`                | Papel sem permissão                    |
| 403  | `PASSWORD_CHANGE_REQUIRED` | Conta ainda usa senha temporária       |
| 429  | `RATE_LIMIT_EXCEEDED`      | Limite global excedido                 |

## Standard pagination contract

Sprint 14.5 consolidou a semântica de paginação para todas as listagens paginadas do backend.

Query params padrão:

| Param   | Type   | Default | Notes                                                                   |
| ------- | ------ | ------- | ----------------------------------------------------------------------- |
| `page`  | number | `1`     | inteiro positivo, mínimo `1`                                            |
| `limit` | number | `20`    | inteiro positivo, máximo definido pelo DTO do módulo, normalmente `100` |

Response padrão:

```json
{
  "success": true,
  "data": {
    "items": [],
    "pagination": {
      "page": 1,
      "limit": 20,
      "total": 0,
      "totalPages": 1
    }
  }
}
```

Regras:

- `totalPages` nunca deve ser menor que `1`;
- filtros e ordenação específicos de cada domínio preservam nomes já documentados;
- payloads enriquecidos podem adicionar campos irmãos de `items` e `pagination`, como
  `timelineGroups`, sem alterar a semântica da paginação.

## Authentication model

- Access token: JWT HS256, padrão de 900 segundos.
- Refresh token: JWT HS256, padrão de 2.592.000 segundos.
- Refresh tokens são single-use.
- Rotação ou logout invalidam imediatamente o access token vinculado à sessão anterior.

## Auth endpoints

Contratos preservados da Sprint 1:

### POST `/api/v1/auth/login`

Request:

```json
{
  "email": "owner@example.com",
  "password": "user-supplied-password"
}
```

Response 200:

```json
{
  "success": true,
  "data": {
    "accessToken": "<jwt>",
    "refreshToken": "<jwt>",
    "expiresIn": 900
  }
}
```

Erros principais: `VALIDATION_ERROR`, `AUTH_INVALID_CREDENTIALS`, `AUTH_USER_INACTIVE`,
`RATE_LIMIT_EXCEEDED`.

### POST `/api/v1/auth/refresh`

Request:

```json
{
  "refreshToken": "<current-refresh-jwt>"
}
```

Response 200: novo `accessToken`, novo `refreshToken`, `expiresIn`.

Erros principais: `VALIDATION_ERROR`, `AUTH_INVALID_TOKEN`, `AUTH_SESSION_REVOKED`,
`RATE_LIMIT_EXCEEDED`.

### POST `/api/v1/auth/logout`

Request:

```json
{
  "refreshToken": "<current-refresh-jwt>"
}
```

Response 200:

```json
{
  "success": true,
  "data": {
    "revoked": true
  }
}
```

### GET `/api/v1/auth/me`

Response 200:

```json
{
  "success": true,
  "data": {
    "id": "f33e0c47-1cb8-4bc9-b4c7-97356ff8749e",
    "email": "owner@example.com",
    "username": "daniel",
    "name": "Daniel",
    "role": "OWNER",
    "isActive": true
  }
}
```

## Health

### GET `/api/v1/health`

Public.

Response 200:

```json
{
  "success": true,
  "data": {
    "status": "ok",
    "uptime": 124.199,
    "timestamp": "2026-06-23T17:44:58.554Z",
    "database_connection": "connected"
  }
}
```

Response 503:

```json
{
  "success": true,
  "data": {
    "status": "degraded",
    "uptime": 130.412,
    "timestamp": "2026-06-23T17:45:00.000Z",
    "database_connection": "disconnected"
  }
}
```

### GET `/api/v1/health/live`

Public. Liveness leve para orquestradores. Não consulta banco nem storage.

Response 200:

```json
{
  "success": true,
  "data": {
    "status": "ok",
    "uptime": 124.199,
    "timestamp": "2026-07-06T12:41:18.702Z",
    "version": "0.1.0"
  }
}
```

### GET `/api/v1/health/ready`

Public. Readiness de produção local/staging. Verifica conexão com PostgreSQL e disponibilidade do
storage configurado.

Response 200:

```json
{
  "success": true,
  "data": {
    "status": "ok",
    "uptime": 124.199,
    "timestamp": "2026-07-06T12:41:18.702Z",
    "database_connection": "connected",
    "storage_connection": "available",
    "version": "0.1.0"
  }
}
```

Response 503:

```json
{
  "success": true,
  "data": {
    "status": "degraded",
    "uptime": 130.412,
    "timestamp": "2026-07-06T12:45:00.000Z",
    "database_connection": "disconnected",
    "storage_connection": "unavailable",
    "version": "0.1.0"
  }
}
```

### GET `/api/v1/metrics`

Public para ambiente interno/orquestrador. Retorna `text/plain; version=0.0.4` no formato
Prometheus e não usa o envelope JSON global.

Exemplo parcial:

```text
# HELP orbit_process_uptime_seconds Process uptime in seconds.
# TYPE orbit_process_uptime_seconds gauge
orbit_process_uptime_seconds 124.199
# HELP orbit_http_requests_total Total HTTP requests.
# TYPE orbit_http_requests_total counter
orbit_http_requests_total{method="GET",route="/api/v1/health/ready",status="200"} 1
```

Métricas expostas não incluem payloads, tokens, e-mails, nomes de clientes ou identificadores
fornecidos via query string.

## Organization

Permissions:

- `OWNER`: leitura e escrita.
- `MANAGER`: somente leitura.
- `OPERATOR` e `VIEWER`: sem acesso.

### GET `/api/v1/organization`

Response 200:

```json
{
  "success": true,
  "data": {
    "id": "8498a905-49f1-4e77-99a4-e84e5151f5ed",
    "legalName": "ERP Operation",
    "tradeName": "ERP Operation",
    "cnpj": "00.000.000/0001-00",
    "email": "contato@example.com",
    "phone": "+55 00 00000-0000",
    "city": "Recife",
    "state": "PE",
    "primaryColor": "#0F172A",
    "secondaryColor": "#2563EB",
    "segment": "HVAC",
    "isActive": true,
    "createdAt": "2026-06-23T17:45:00.000Z",
    "updatedAt": "2026-06-23T17:45:00.000Z"
  }
}
```

Errors: common protected errors, `ORGANIZATION_NOT_FOUND`.

### PATCH `/api/v1/organization`

Role: `OWNER`.

Request: todos os campos são opcionais; campos extras são rejeitados.

```json
{
  "legalName": "Empresa Exemplo LTDA",
  "tradeName": "Empresa Exemplo",
  "cnpj": "12.345.678/0001-90",
  "email": "contato@empresa.com",
  "phone": "+55 81 99999-9999",
  "city": "Recife",
  "state": "PE",
  "primaryColor": "#111827",
  "secondaryColor": "#2563EB",
  "segment": "HVAC",
  "isActive": true
}
```

Response 200: objeto `Organization` atualizado.

Errors:

| HTTP | Code                     | Condition                   |
| ---- | ------------------------ | --------------------------- |
| 400  | `VALIDATION_ERROR`       | Payload inválido            |
| 404  | `ORGANIZATION_NOT_FOUND` | Seed organizacional ausente |
| 403  | `FORBIDDEN`              | Não-OWNER tentando escrever |

## Organization settings

### GET `/api/v1/organization/settings`

Roles: `OWNER`, `MANAGER`.

Response 200:

```json
{
  "success": true,
  "data": {
    "id": "6bed5b82-0e9e-4f3e-94d0-e2f8e08c6e9c",
    "organizationId": "8498a905-49f1-4e77-99a4-e84e5151f5ed",
    "language": "pt-BR",
    "timezone": "America/Recife",
    "currency": "BRL",
    "documentPrefix": "ERP",
    "createdAt": "2026-06-23T17:45:00.000Z",
    "updatedAt": "2026-06-23T17:45:00.000Z"
  }
}
```

### PATCH `/api/v1/organization/settings`

Role: `OWNER`.

Request:

```json
{
  "language": "pt-BR",
  "timezone": "America/Recife",
  "currency": "BRL",
  "documentPrefix": "ERP"
}
```

Response 200: objeto `OrganizationSettings` atualizado.

Errors: common protected errors, `VALIDATION_ERROR`, `ORGANIZATION_NOT_FOUND`.

## Document templates

`type` é um de:

- `QUOTE`
- `WORK_ORDER`
- `RECEIPT`
- `REPORT`
- `TECHNICAL_REPORT`
- `PMOC`

### GET `/api/v1/organization/templates`

Roles: `OWNER`, `MANAGER`.

Response 200:

```json
{
  "success": true,
  "data": [
    {
      "id": "f38b0b79-5c79-4f74-8d66-e6f3f77ad9aa",
      "organizationId": "8498a905-49f1-4e77-99a4-e84e5151f5ed",
      "type": "QUOTE",
      "name": "Orçamento padrão",
      "headerContent": "",
      "footerContent": "",
      "observations": "",
      "isDefault": true,
      "isSystem": true,
      "isActive": true,
      "requiresSignature": false,
      "signatureMode": "NONE",
      "signatureId": null,
      "createdAt": "2026-06-23T17:45:00.000Z",
      "updatedAt": "2026-06-23T17:45:00.000Z"
    }
  ]
}
```

### POST `/api/v1/organization/templates`

Role: `OWNER`.

Request:

```json
{
  "type": "QUOTE",
  "name": "Orçamento com cabeçalho comercial",
  "headerContent": "<p>Conteúdo livre controlado pelo frontend</p>",
  "footerContent": "",
  "observations": "",
  "isDefault": false,
  "isActive": true,
  "requiresSignature": true,
  "signatureMode": "FIXED",
  "signatureId": "7198f91a-418f-4c3d-b8db-4ff7f8a9c0b1"
}
```

Response 201: objeto `DocumentTemplate` criado. `isActive` é opcional (default `true`)
e habilita o controle de ativar/desativar modelos.

Configuração de assinatura:

- `signatureMode`: `NONE`, `FIXED`, `COLLECTED` ou `HYBRID`;
- `NONE`: `requiresSignature=false` e `signatureId=null`;
- `FIXED` e `HYBRID`: exigem `requiresSignature=true` e `signatureId` de uma assinatura ativa;
- `COLLECTED`: exige `requiresSignature=true` e não usa `signatureId`.

### PATCH `/api/v1/organization/templates/:id`

Role: `OWNER`. `:id` deve ser UUID v4.

Request: todos os campos são opcionais.

```json
{
  "name": "Orçamento padrão atualizado",
  "observations": "Validade de 7 dias",
  "isDefault": true,
  "isActive": false,
  "signatureMode": "COLLECTED",
  "requiresSignature": true,
  "signatureId": null
}
```

Response 200: objeto `DocumentTemplate` atualizado. `isActive` controla ativar/desativar o modelo.

### DELETE `/api/v1/organization/templates/:id`

Role: `OWNER`. `:id` deve ser UUID v4.

Response 200:

```json
{
  "success": true,
  "data": {
    "deleted": true
  }
}
```

Errors para templates:

| HTTP | Code                        | Condition                                  |
| ---- | --------------------------- | ------------------------------------------ |
| 400  | `VALIDATION_ERROR`          | Body ou UUID inválido                      |
| 404  | `NOT_FOUND`                 | Template inexistente na organização        |
| 403  | `FORBIDDEN`                 | Papel sem permissão                        |
| 409  | `SYSTEM_TEMPLATE_PROTECTED` | Tentativa de excluir template do sistema   |
| 409  | `SIGNATURE_INACTIVE`        | Template apontando para assinatura inativa |
| 404  | `SIGNATURE_NOT_FOUND`       | `signatureId` inexistente                  |

Quando `isDefault=true`, templates anteriores do mesmo `type` são marcados como não-default.
Templates criados pela API recebem `isSystem=false`. Templates com `isSystem=true` podem ser
editados, mas não excluídos.

## Document configuration

Sprint 7 cria a camada de consulta centralizada para configuração documental. O frontend pode usar
estes endpoints para montar telas de configuração e inspecionar o comportamento efetivo de cada
tipo de documento.

Permissões: `OWNER`, `MANAGER` e `VIEWER`. `OPERATOR` não acessa.

### GET `/api/v1/documents/configuration`

Response 200:

```json
{
  "success": true,
  "data": [
    {
      "type": "WORK_ORDER",
      "organization": {
        "id": "8498a905-49f1-4e77-99a4-e84e5151f5ed",
        "legalName": "ERP Operation",
        "tradeName": "ERP Operation",
        "cnpj": "00.000.000/0001-00",
        "email": "contato@example.com",
        "phone": "+55 81 99999-9999",
        "city": "Recife",
        "state": "PE",
        "primaryColor": "#111827",
        "secondaryColor": "#2563EB"
      },
      "settings": {
        "id": "22ae5a08-04db-4ad0-b49e-311230fb5991",
        "language": "pt-BR",
        "timezone": "America/Recife",
        "currency": "BRL",
        "documentPrefix": "ERP"
      },
      "defaultTemplate": {
        "id": "f38b0b79-5c79-4f74-8d66-e6f3f77ad9aa",
        "type": "WORK_ORDER",
        "name": "Ordem de serviço padrão",
        "isDefault": true,
        "isSystem": true,
        "isActive": true,
        "requiresSignature": false,
        "signatureMode": "NONE",
        "signatureId": null,
        "signature": null
      },
      "templates": []
    }
  ]
}
```

### GET `/api/v1/documents/configuration/types/:type`

`:type` deve ser `QUOTE`, `WORK_ORDER`, `RECEIPT`, `REPORT`, `TECHNICAL_REPORT` ou `PMOC`.

Response 200: mesmo objeto de configuração para um único tipo.

### GET `/api/v1/documents/configuration/templates/:templateId`

`:templateId` deve ser UUID v4.

Response 200: configuração completa do tipo ao qual o template pertence.

Erros: common protected errors, `VALIDATION_ERROR`, `NOT_FOUND`, `ORGANIZATION_NOT_FOUND`.

## Signatures

Domínio de assinaturas cadastra assinaturas fixas reutilizáveis por templates. Imagens ficam no
StorageProvider; o backend mantém a storage key apenas internamente. O contrato público retorna
`hasImage` e nunca expõe `imageStorageKey`.

Permissões:

- `OWNER`: criar, editar, upload, soft delete, listar e baixar;
- `MANAGER`: listar, detalhar e baixar;
- `VIEWER`: listar, detalhar e baixar;
- `OPERATOR`: sem acesso.

### GET `/api/v1/signatures`

Query:

- `page` default `1`;
- `limit` default `20`, máximo `100`;
- `search` opcional;
- `active` opcional.

Response 200:

```json
{
  "success": true,
  "data": {
    "items": [
      {
        "id": "7198f91a-418f-4c3d-b8db-4ff7f8a9c0b1",
        "name": "Responsável Técnico",
        "title": "Eng. Mecânico CREA 000000",
        "hasImage": true,
        "mimeType": "image/png",
        "originalFileName": "assinatura.png",
        "fileSize": 18432,
        "active": true,
        "deletedAt": null,
        "createdAt": "2026-06-29T15:00:00.000Z",
        "updatedAt": "2026-06-29T15:02:00.000Z"
      }
    ],
    "pagination": {
      "page": 1,
      "limit": 20,
      "total": 1,
      "totalPages": 1
    }
  }
}
```

### GET `/api/v1/signatures/:id`

Response 200: objeto `Signature`.

### POST `/api/v1/signatures`

Role: `OWNER`.

```json
{
  "name": "Responsável Técnico",
  "title": "Eng. Mecânico CREA 000000",
  "active": true
}
```

Response 201: objeto `Signature`.

### PATCH `/api/v1/signatures/:id`

Role: `OWNER`. Campos opcionais: `name`, `title`, `active`.

### DELETE `/api/v1/signatures/:id`

Role: `OWNER`. Soft delete (`active=false`).

Response 200:

```json
{
  "success": true,
  "data": {
    "deleted": true
  }
}
```

### POST `/api/v1/signatures/:id/upload`

Role: `OWNER`. `multipart/form-data` com campo `file`.

Regras:

- formatos permitidos: PNG, JPG, JPEG;
- tamanho máximo: 2 MiB;
- valida MIME, extensão e assinatura binária;
- nome original é sanitizado;
- storage key é gerada pelo backend.

Response 201: objeto `Signature` atualizado.

### GET `/api/v1/signatures/:id/download`

Roles: `OWNER`, `MANAGER`, `VIEWER`.

Response 200:

```json
{
  "success": true,
  "data": {
    "id": "7198f91a-418f-4c3d-b8db-4ff7f8a9c0b1",
    "name": "Responsável Técnico",
    "title": "Eng. Mecânico CREA 000000",
    "mimeType": "image/png",
    "fileSize": 18432,
    "active": true,
    "contentBase64": "iVBORw0KGgoAAA..."
  }
}
```

Erros:

| HTTP | Code                       | Condition                           |
| ---- | -------------------------- | ----------------------------------- |
| 400  | `VALIDATION_ERROR`         | Body, query ou UUID inválido        |
| 400  | `SIGNATURE_IMAGE_REQUIRED` | Upload ausente                      |
| 400  | `UPLOAD_FILE_TOO_LARGE`    | Arquivo vazio ou acima de 2 MiB     |
| 400  | `UPLOAD_INVALID_MIME_TYPE` | MIME/binário incompatível           |
| 400  | `UPLOAD_INVALID_EXTENSION` | Extensão não permitida              |
| 403  | `FORBIDDEN`                | Papel sem permissão                 |
| 404  | `SIGNATURE_NOT_FOUND`      | Assinatura inexistente              |
| 409  | `SIGNATURE_IMAGE_REQUIRED` | Download solicitado antes do upload |

## Brand assets

`type` é um de:

- `LOGO`
- `HEADER`
- `FOOTER`

### POST `/api/v1/organization/assets`

Role: `OWNER`.

Content-Type: `multipart/form-data`

Campos:

- `type`: `LOGO`, `HEADER` ou `FOOTER`;
- `file`: arquivo.

Regras:

- tamanho máximo: 5 MiB;
- extensões permitidas: `png`, `jpg`, `jpeg`, `svg`, `pdf`;
- MIME types permitidos: `image/png`, `image/jpeg`, `image/svg+xml`, `application/pdf`.

Response 201:

```json
{
  "success": true,
  "data": {
    "id": "ec60c6ae-391b-40d8-80e1-2d850a4d931b",
    "organizationId": "8498a905-49f1-4e77-99a4-e84e5151f5ed",
    "type": "LOGO",
    "storageKey": "organization/logo/b3f0f7e4-5802-40e6-b346-4d42adf67143.png",
    "mimeType": "image/png",
    "originalFileName": "logo.png",
    "fileSize": 8,
    "createdAt": "2026-06-23T17:45:00.000Z"
  }
}
```

### GET `/api/v1/organization/assets/:id`

Roles: `OWNER`, `MANAGER`. `:id` deve ser UUID v4.

Response 200:

```json
{
  "success": true,
  "data": {
    "id": "ec60c6ae-391b-40d8-80e1-2d850a4d931b",
    "organizationId": "8498a905-49f1-4e77-99a4-e84e5151f5ed",
    "type": "LOGO",
    "storageKey": "organization/logo/b3f0f7e4-5802-40e6-b346-4d42adf67143.png",
    "mimeType": "image/png",
    "originalFileName": "logo.png",
    "fileSize": 8,
    "createdAt": "2026-06-23T17:45:00.000Z",
    "contentBase64": "iVBORw0KGgo="
  }
}
```

O frontend pode montar uma data URL:

```text
data:<mimeType>;base64,<contentBase64>
```

### DELETE `/api/v1/organization/assets/:id`

Role: `OWNER`. `:id` deve ser UUID v4.

Response 200:

```json
{
  "success": true,
  "data": {
    "deleted": true
  }
}
```

Errors para assets:

| HTTP | Code                       | Condition                        |
| ---- | -------------------------- | -------------------------------- |
| 400  | `VALIDATION_ERROR`         | `type` ou UUID inválido          |
| 400  | `UPLOAD_FILE_REQUIRED`     | Campo `file` ausente             |
| 400  | `UPLOAD_FILE_TOO_LARGE`    | Arquivo maior que 5 MiB          |
| 400  | `UPLOAD_INVALID_MIME_TYPE` | MIME type não permitido          |
| 400  | `UPLOAD_INVALID_EXTENSION` | Extensão não permitida           |
| 404  | `NOT_FOUND`                | Asset inexistente no banco       |
| 404  | `STORAGE_FILE_NOT_FOUND`   | Registro existe, arquivo ausente |
| 403  | `FORBIDDEN`                | Papel sem permissão              |

## Users and team

### Access matrix

| Operation                          | OWNER | MANAGER | OPERATOR | VIEWER |
| ---------------------------------- | ----- | ------- | -------- | ------ |
| List/get team                      | Sim   | Sim     | Não      | Sim    |
| Create/update/disable/delete/reset | Sim   | Não     | Não      | Não    |
| Own profile/preferences/password   | Sim   | Sim     | Sim      | Sim    |
| Own avatar                         | Sim   | Sim     | Sim      | Sim    |

### User object

```json
{
  "id": "6c9f1fc4-8bfd-4873-b068-b1bc834fef12",
  "email": "manager@example.com",
  "username": "manager",
  "name": "Manager Teste",
  "role": "MANAGER",
  "avatarAssetId": null,
  "phone": "+55 81 99999-9999",
  "jobTitle": "Supervisor",
  "notes": null,
  "mustChangePassword": true,
  "isActive": true,
  "disabledAt": null,
  "lastLoginAt": null,
  "createdAt": "2026-06-24T12:00:00.000Z",
  "updatedAt": "2026-06-24T12:00:00.000Z",
  "permission": {
    "canFinancial": false,
    "canUsers": false,
    "canReports": true,
    "canSchedules": true,
    "canTemplates": false
  },
  "preferences": {
    "id": "6c5b5034-a180-44d5-9198-cab4589a8043",
    "userId": "6c9f1fc4-8bfd-4873-b068-b1bc834fef12",
    "theme": "SYSTEM",
    "notificationsEnabled": true,
    "createdAt": "2026-06-24T12:00:00.000Z",
    "updatedAt": "2026-06-24T12:00:00.000Z"
  }
}
```

Passwords and hashes never appear inside the user object.

### GET `/api/v1/users`

Roles: `OWNER`, `MANAGER`, `VIEWER`.

Query:

- `page`: integer >= 1, default `1`;
- `limit`: integer from 1 to 100, default `20`;
- `search`: optional, searches name, email, username, phone and job title.

Response 200:

```json
{
  "success": true,
  "data": {
    "items": [],
    "pagination": {
      "page": 1,
      "limit": 20,
      "total": 0,
      "totalPages": 0
    }
  }
}
```

### GET `/api/v1/users/:id`

Roles: `OWNER`, `MANAGER`, `VIEWER`. `:id` is UUID v4.

Response 200: User object.

Errors: `VALIDATION_ERROR`, `USER_NOT_FOUND`, common protected errors.

### POST `/api/v1/users`

Role: `OWNER`.

Request:

```json
{
  "email": "manager@example.com",
  "username": "manager",
  "name": "Manager Teste",
  "role": "MANAGER",
  "phone": "+55 81 99999-9999",
  "jobTitle": "Supervisor",
  "notes": "Internal administrative note",
  "permissions": {
    "canFinancial": false,
    "canUsers": false,
    "canReports": true,
    "canSchedules": true,
    "canTemplates": false
  }
}
```

Response 201:

```json
{
  "success": true,
  "data": {
    "user": {},
    "temporaryPassword": "<shown-once-random-password>"
  }
}
```

The password is generated by the backend, is not logged, and is returned only in this response.
The created user has `mustChangePassword=true`.

Errors:

| HTTP | Code               | Condition                      |
| ---- | ------------------ | ------------------------------ |
| 400  | `VALIDATION_ERROR` | Invalid payload                |
| 409  | `USER_CONFLICT`    | Email or username already used |
| 403  | `FORBIDDEN`        | Actor is not OWNER             |

### PATCH `/api/v1/users/:id`

Role: `OWNER`.

Request: partial form of the create payload. Password, active status and `mustChangePassword`
cannot be changed here.

Response 200: updated User object.

Additional error: `USER_LAST_OWNER` when attempting to demote the last active OWNER.

### DELETE `/api/v1/users/:id`

Role: `OWNER`. Performs soft delete.

Response 200:

```json
{
  "success": true,
  "data": {
    "deleted": true
  }
}
```

The user remains queryable with `isActive=false` and `disabledAt` populated. Active sessions are
revoked.

Errors: `USER_NOT_FOUND`, `USER_SELF_ACTION_FORBIDDEN`, `USER_LAST_OWNER`.

### PATCH `/api/v1/users/:id/disable`

Role: `OWNER`. No body.

Response 200: User object with `isActive=false` and `disabledAt` populated. Sessions are revoked.

### PATCH `/api/v1/users/:id/enable`

Role: `OWNER`. No body.

Response 200: User object with `isActive=true` and `disabledAt=null`.

### PATCH `/api/v1/users/:id/reset-password`

Role: `OWNER`. No body.

Response 200:

```json
{
  "success": true,
  "data": {
    "userId": "6c9f1fc4-8bfd-4873-b068-b1bc834fef12",
    "temporaryPassword": "<shown-once-random-password>",
    "mustChangePassword": true
  }
}
```

All existing sessions for the target user are revoked.

### PATCH `/api/v1/users/change-password`

All authenticated roles, own account.

Request:

```json
{
  "currentPassword": "current-password",
  "newPassword": "new-password-with-at-least-12-characters"
}
```

Response 200:

```json
{
  "success": true,
  "data": {
    "changed": true,
    "reauthenticationRequired": true
  }
}
```

All sessions, including the current one, are revoked. The client must clear tokens and log in
again.

Errors:

| HTTP | Code                         | Condition                       |
| ---- | ---------------------------- | ------------------------------- |
| 400  | `PASSWORD_CURRENT_INVALID`   | Current password does not match |
| 400  | `PASSWORD_REUSE_NOT_ALLOWED` | New password equals current one |
| 400  | `VALIDATION_ERROR`           | Password shorter than 12 chars  |

### GET `/api/v1/users/me`

All authenticated roles. Allowed while password change is required.

Response 200:

```json
{
  "success": true,
  "data": {
    "user": {
      "id": "6c9f1fc4-8bfd-4873-b068-b1bc834fef12",
      "email": "manager@example.com",
      "username": "manager",
      "name": "Manager Teste",
      "avatarAssetId": null,
      "phone": "+55 81 99999-9999",
      "jobTitle": "Supervisor",
      "role": "MANAGER",
      "isActive": true,
      "mustChangePassword": false
    },
    "organization": {
      "id": "8498a905-49f1-4e77-99a4-e84e5151f5ed",
      "legalName": "Empresa Exemplo LTDA",
      "tradeName": "Empresa Exemplo",
      "segment": "HVAC",
      "primaryColor": "#111827",
      "secondaryColor": "#2563EB",
      "isActive": true
    },
    "role": "MANAGER",
    "permissions": {
      "canFinancial": false,
      "canUsers": false,
      "canReports": true,
      "canSchedules": true,
      "canTemplates": false
    },
    "preferences": {
      "id": "6c5b5034-a180-44d5-9198-cab4589a8043",
      "userId": "6c9f1fc4-8bfd-4873-b068-b1bc834fef12",
      "theme": "DARK",
      "notificationsEnabled": false,
      "createdAt": "2026-06-24T12:00:00.000Z",
      "updatedAt": "2026-06-24T12:00:00.000Z"
    }
  }
}
```

### GET `/api/v1/users/me/preferences`

All authenticated roles, own account.

Response 200: preferences object. `theme` is `SYSTEM`, `LIGHT` or `DARK`.

### PATCH `/api/v1/users/me/preferences`

Request:

```json
{
  "theme": "DARK",
  "notificationsEnabled": false
}
```

Response 200: updated preferences.

No language or locale property exists in V1.

## User avatar

### POST `/api/v1/users/avatar`

All authenticated roles, own account. `multipart/form-data`, field `file`.

Rules:

- maximum 2 MiB;
- extensions `png`, `jpg`, `jpeg`;
- MIME `image/png` or `image/jpeg`;
- PNG/JPEG binary signature must match the declared MIME.

Response 201:

```json
{
  "success": true,
  "data": {
    "id": "406aa7f1-f008-470a-a99d-a8998780635c",
    "storageKey": "users/avatar/08e2664f-fba5-448f-83fa-16e23335aca1.png",
    "mimeType": "image/png",
    "originalFileName": "avatar.png",
    "fileSize": 182034,
    "createdAt": "2026-06-24T12:00:00.000Z"
  }
}
```

Uploading a new avatar replaces the previous one.

### GET `/api/v1/users/avatar/:id`

All authenticated roles. `:id` is the `avatarAssetId`.

Response 200: avatar metadata plus `contentBase64`.

### DELETE `/api/v1/users/avatar`

All authenticated roles, own avatar.

Response 200:

```json
{
  "success": true,
  "data": {
    "deleted": true
  }
}
```

Deletion is idempotent when the user has no avatar.

## Team-specific errors

| HTTP | Code                         | Frontend meaning                       |
| ---- | ---------------------------- | -------------------------------------- |
| 403  | `PASSWORD_CHANGE_REQUIRED`   | Redirect to mandatory password screen  |
| 404  | `USER_NOT_FOUND`             | User does not exist                    |
| 409  | `USER_CONFLICT`              | Email/username already exists          |
| 409  | `USER_LAST_OWNER`            | Protected last active OWNER            |
| 409  | `USER_SELF_ACTION_FORBIDDEN` | OWNER tried to disable/delete self     |
| 400  | `UPLOAD_INVALID_MIME_TYPE`   | Invalid or forged avatar content       |
| 400  | `UPLOAD_INVALID_EXTENSION`   | Avatar extension not allowed           |
| 413  | `UPLOAD_FILE_TOO_LARGE`      | Multipart exceeded the hard size limit |

## Customers

`CustomerType`: `PERSON` ou `COMPANY`. CPF e CNPJ são opcionais; quando informados, são únicos.

RBAC:

- leitura/lista/stats/detalhes/anexo: todos os papéis;
- criação, atualização, enable/disable, addresses e contacts: OWNER/MANAGER;
- soft delete de customer e delete de attachment: OWNER.

### GET `/api/v1/customers`

Query: `page` (default 1), `limit` (default 20, máximo 100), `search` opcional. Busca parcial em
name, tradeName, phone, secondaryPhone, email, cpf e cnpj.

Response 200:

```json
{
  "success": true,
  "data": {
    "items": [
      {
        "id": "uuid",
        "type": "COMPANY",
        "name": "Hospital Santa Clara",
        "tradeName": "Hospital Santa Clara",
        "cpf": null,
        "cnpj": "27.584.162/0001-08",
        "email": "contato@hospital.example",
        "phone": "+55 81 3030-4040",
        "secondaryPhone": null,
        "notes": null,
        "isActive": true,
        "disabledAt": null,
        "createdAt": "2026-06-24T12:00:00.000Z",
        "updatedAt": "2026-06-24T12:00:00.000Z",
        "_count": { "addresses": 1, "contacts": 1, "attachments": 1 }
      }
    ],
    "pagination": { "page": 1, "limit": 20, "total": 1, "totalPages": 1 }
  }
}
```

### GET `/api/v1/customers/stats`

Response data:

```json
{ "total": 4, "active": 4, "inactive": 0, "people": 0, "companies": 4 }
```

### GET `/api/v1/customers/:id`

Returns the customer with complete `addresses`, `contacts` and attachment metadata arrays.

### POST `/api/v1/customers`

```json
{
  "type": "COMPANY",
  "name": "Hospital Santa Clara",
  "tradeName": "Santa Clara",
  "cnpj": "27.584.162/0001-08",
  "email": "hospital@example.com",
  "phone": "+55 81 3030-4040",
  "secondaryPhone": "+55 81 3030-4041",
  "notes": "Contrato preventivo"
}
```

Response 201: Customer. `cpf`, `cnpj`, `tradeName`, email, phones and notes are optional.

### PATCH `/api/v1/customers/:id`

Partial form of create payload. Response 200: updated Customer.

### DELETE `/api/v1/customers/:id`

OWNER only. Soft delete. Response: `{ "deleted": true }`.

### PATCH `/api/v1/customers/:id/disable` and `/enable`

OWNER/MANAGER. No body. Response: Customer with updated `isActive`/`disabledAt`.

### Addresses

POST `/customers/:id/addresses`:

```json
{
  "name": "Unidade principal",
  "zipCode": "51020-000",
  "street": "Rua das Acácias",
  "number": "120",
  "complement": "Bloco A",
  "district": "Boa Viagem",
  "city": "Recife",
  "state": "PE",
  "isPrimary": true
}
```

PATCH `/customers/:id/addresses/:addressId` accepts partial payload. DELETE returns
`{ "deleted": true }`. Setting `isPrimary=true` clears the previous primary address.

### Contacts

POST `/customers/:id/contacts`:

```json
{
  "name": "Mariana Costa",
  "role": "Engenharia Clínica",
  "phone": "+55 81 99999-0000",
  "email": "mariana@example.com",
  "notes": "",
  "isPrimary": true
}
```

PATCH is partial; DELETE returns `{ "deleted": true }`. Phone and email are optional.

### Attachments

POST `/customers/:id/attachments`, multipart fields:

- `category`: string, 2–80 chars;
- `file`: PDF/PNG/JPG/JPEG, máximo 5 MiB.

GET `/customers/attachments/:attachmentId` returns metadata plus `contentBase64`.
DELETE `/customers/attachments/:attachmentId` is OWNER-only.

Errors:

| HTTP | Code                       | Condition                 |
| ---- | -------------------------- | ------------------------- |
| 404  | `CUSTOMER_NOT_FOUND`       | Customer inexistente      |
| 404  | `NOT_FOUND`                | Sub-recurso inexistente   |
| 409  | `CUSTOMER_CONFLICT`        | CPF/CNPJ já utilizado     |
| 400  | `VALIDATION_ERROR`         | Payload inválido          |
| 400  | `UPLOAD_FILE_REQUIRED`     | Arquivo ausente           |
| 400  | `UPLOAD_INVALID_EXTENSION` | Extensão inválida         |
| 400  | `UPLOAD_INVALID_MIME_TYPE` | MIME/conteúdo inválido    |
| 413  | `UPLOAD_FILE_TOO_LARGE`    | Multipart maior que 5 MiB |

## Equipments

Enums:

- type: `SPLIT`, `CHILLER`, `CONDENSER`, `EVAPORATOR`, `AIR_HANDLER`, `SOLAR_INVERTER`,
  `ELECTRICAL_PANEL`, `GENERATOR`, `OTHER`;
- status: `ACTIVE`, `MAINTENANCE`, `INACTIVE`, `RETIRED`;
- attachment category: `PHOTO`, `MANUAL`, `WARRANTY`, `DOCUMENT`.

### GET `/api/v1/equipments`

Query: `page`, `limit`, `search`, `customerId`, `addressId`, `status`, `type`. Search is partial over
name, tag, serialNumber, model and manufacturer.

Response data: `{ items, pagination }`. Each item includes summarized customer/address and `_count`
for children, attachments and metrics.

### GET `/api/v1/equipments/stats`

```json
{
  "total": 5,
  "active": 4,
  "maintenance": 1,
  "inactive": 0,
  "retired": 0,
  "byType": {
    "SPLIT": 1,
    "CHILLER": 1,
    "CONDENSER": 1,
    "EVAPORATOR": 1,
    "AIR_HANDLER": 0,
    "SOLAR_INVERTER": 1,
    "ELECTRICAL_PANEL": 0,
    "GENERATOR": 0,
    "OTHER": 0
  }
}
```

### POST `/api/v1/equipments`

OWNER/MANAGER:

```json
{
  "customerId": "uuid",
  "addressId": "uuid",
  "parentEquipmentId": null,
  "type": "SPLIT",
  "status": "ACTIVE",
  "name": "Split Samsung 24.000 BTU",
  "tag": "CBV-SPL-001",
  "manufacturer": "Samsung",
  "model": "WindFree 24K",
  "serialNumber": "SN-2026-001",
  "capacity": "24.000 BTU",
  "voltage": "220V",
  "installationDate": "2024-03-15",
  "warrantyExpiration": "2027-03-15",
  "observations": "Unidade da sala 12"
}
```

Response 201 adds UUID `qrToken`, stable `qrCode`, timestamps and state fields. Address and parent
must belong to the selected Customer.

### GET/PATCH/DELETE `/api/v1/equipments/:id`

GET all roles; PATCH OWNER/MANAGER; DELETE OWNER and performs soft delete. Detail includes customer,
address, parent, children, attachment metadata and the 20 latest metrics.

PATCH `/equipments/:id/disable` and `/enable`: OWNER/MANAGER. Disable sets status `INACTIVE`;
enable sets `ACTIVE`.

### Attachments

POST `/equipments/:id/attachments`: OWNER/MANAGER, multipart `category` + `file`, 5 MiB,
PDF/PNG/JPG/JPEG.

GET `/equipments/attachments/:attachmentId`: all roles, metadata plus `contentBase64`.

DELETE `/equipments/attachments/:attachmentId`: OWNER/MANAGER.

### Metrics

POST `/equipments/:id/metrics`: OWNER/MANAGER/OPERATOR.

```json
{ "key": "temperature", "value": 22.4, "unit": "°C", "recordedAt": "2026-06-24T12:00:00Z" }
```

`recordedAt` is optional and defaults to server time.

GET `/equipments/:id/metrics`: all roles, newest first.

DELETE `/equipments/:id/metrics/:metricId`: OWNER/MANAGER.

Errors: `EQUIPMENT_NOT_FOUND`, `EQUIPMENT_ADDRESS_MISMATCH`, `EQUIPMENT_HIERARCHY_INVALID`,
`CUSTOMER_NOT_FOUND`, `NOT_FOUND`, validation/upload/common protected errors.

## Schedule (Agenda)

Não existe endpoint nem dataset paralelo de Agenda. A interface compõe o calendário exclusivamente
a partir dos contratos oficiais de Operations, Assignments, Maintenance e PMOC descritos neste
documento. `/api/v1/schedule` não é um contrato ativo.

## Equipment lookup by QR

### GET `/api/v1/equipments/lookup/:qrCode`

Roles: `OWNER`, `MANAGER`, `OPERATOR`, `VIEWER`.

Localiza o equipamento pelo identificador do QR. `:qrCode` deve vir
URL-encoded (o valor inclui `:`, ex.: `equipment%3A<uuid>`). Aceita tanto o
`qrCode` (`equipment:<qrToken>`) quanto o `qrToken`, preparando o terreno para
formatos futuros de QR assinado/tokenizado — sem alterar o formato atual.

Response 200: mesmo payload de `GET /equipments/:id` (equipamento completo com
customer, address, parent, children, attachments e métricas).

Errors:

| HTTP | Code                  | Condition                    |
| ---- | --------------------- | ---------------------------- |
| 400  | `VALIDATION_ERROR`    | QR vazio/ausente             |
| 404  | `EQUIPMENT_NOT_FOUND` | Nenhum equipamento para o QR |

> O formato do QR exibido na Platform não muda; o QR codifica o `qrCode`.

## Operations (domínio operacional central)

Uma `Operation` é o atendimento de campo — fundação reutilizada por todos os
documentos (OS, PMOC, Laudo, Relatório, Orçamento, Recibo). Toda OS nasce de uma
Operation. Ao criar uma Operation, o backend gera automaticamente um
`OperationDocument` do tipo `WORK_ORDER` em `DRAFT`, com número derivado do número
sequencial da operação (`OS-000001`).

| Método | Rota                          | Roles                         | Descrição                                                                                                  |
| ------ | ----------------------------- | ----------------------------- | ---------------------------------------------------------------------------------------------------------- |
| GET    | `/operations`                 | OWNER/MANAGER/OPERATOR/VIEWER | Lista paginada. Filtros: `page,limit,search,customerId,equipmentId,operatorId,type,status`                 |
| GET    | `/operations/stats`           | OWNER/MANAGER/OPERATOR/VIEWER | `{ total, byStatus }`                                                                                      |
| GET    | `/operations/:id`             | OWNER/MANAGER/OPERATOR/VIEWER | Detalhe (customer, address, equipment, operator, checklist, photos, documents, signature)                  |
| GET    | `/operations/photos/:photoId` | OWNER/MANAGER/OPERATOR/VIEWER | Foto em base64 (`{ mimeType, contentBase64, ... }`)                                                        |
| POST   | `/operations`                 | OWNER/MANAGER/OPERATOR        | Cria a Operation + OS rascunho. OWNER/MANAGER podem delegar via `operatorId`; OPERATOR sempre cria para si |
| PATCH  | `/operations/:id`             | OWNER/MANAGER/OPERATOR        | Atualiza status/datas/checklist/observações                                                                |

`POST /operations` (body):

```jsonc
{
  "customerId": "<uuid>", // obrigatório
  "addressId": "<uuid>", // opcional (deve pertencer ao cliente)
  "equipmentId": "<uuid>", // opcional (deve pertencer ao cliente)
  "operatorId": "<uuid>", // opcional; delegação permitida apenas para OWNER/MANAGER
  "type": "PREVENTIVA", // PREVENTIVA|CORRETIVA|INSTALACAO|PROJETO
  "status": "COMPLETED", // opcional, default DRAFT
  "startedAt": "<iso>",
  "completedAt": "<iso>",
  "checklist": [{ "label": "…", "done": true, "note": null }],
  "observations": "…",
  "signatureData": "data:image/png;base64,…", // texto (data URL)
  "signedAt": "<iso>",
  "photos": [{ "dataUrl": "data:image/jpeg;base64,…", "caption": "…" }],
}
```

Delegação: `OWNER` e `MANAGER` podem informar `operatorId`. Se omitido, o backend
usa o usuário autenticado. `OPERATOR` não delega: mesmo enviando `operatorId`, a
operação é atribuída ao próprio usuário autenticado e o campo enviado é ignorado
após validação de UUID. O operador informado precisa existir, estar ativo, não
estar desativado e possuir perfil operacional (`OWNER`, `MANAGER` ou `OPERATOR`).
Como a instalação é single-company, a validação de organização é garantida pelo
banco isolado da empresa; não há atribuição cross-tenant.

Fotos: PNG/JPEG (data URL), máx. 16 por operação, 5 MiB cada; persistidas via
storage provider. Assinatura: data URL armazenada como texto.

O body JSON de `/operations` possui limite HTTP específico configurado por
`OPERATION_JSON_BODY_LIMIT_BYTES` (default `125829120`, 120 MiB). Esse limite existe porque Base64
adiciona overhead ao tamanho binário das evidências. As demais rotas JSON usam
`HTTP_JSON_BODY_LIMIT_BYTES` (default `1048576`, 1 MiB).

Errors: `CUSTOMER_NOT_FOUND` (404), `VALIDATION_ERROR` (400, endereço/equipamento
fora do cliente), `OPERATION_PHOTO_INVALID` (400), `OPERATION_NOT_FOUND` (404),
`OPERATION_PHOTO_NOT_FOUND` (404), `OPERATION_OPERATOR_INVALID` (400, operador
delegado inexistente, inativo, desativado ou sem perfil operacional),
`UPLOAD_FILE_TOO_LARGE` (413, body JSON acima do limite da rota).

Migration: `20260627150000_operation_domain_foundation` (tabelas `operations`,
`operation_photos`, `operation_documents` + enums).

## Document Engine

Sprint 6 cria o motor oficial de documentos de produção:

```text
Operation → DocumentBuilder → DocumentBlueprint → DocumentRenderer → PDF Engine
```

O Builder resolve dados operacionais e gera um Blueprint independente de PDF. O Renderer pagina o
Blueprint. O PDF Engine gera PDF diretamente, sem HTML/print.

Tipos válidos em `:type`:

```ts
type DocumentTemplateType =
  | 'QUOTE'
  | 'WORK_ORDER'
  | 'RECEIPT'
  | 'REPORT'
  | 'TECHNICAL_REPORT'
  | 'PMOC';
```

Permissões:

- `OWNER`: todos os tipos e ações;
- `MANAGER`: preview/render/download de tipos não financeiros;
- `OPERATOR`: preview/render/download de tipos não financeiros;
- `VIEWER`: preview/download de tipos não financeiros;
- `QUOTE` e `RECEIPT`: somente `OWNER`.

### Blueprint response

Preview retorna o documento estruturado, sem PDF:

```ts
type DocumentBlueprint = {
  version: '1.0';
  metadata: {
    operationId: string;
    documentId: string | null;
    documentType: DocumentTemplateType;
    documentNumber: string;
    generatedAt: string;
    locale: 'pt-BR';
    timezone: string;
    currency: string;
    organization: {
      legalName: string;
      tradeName: string;
      cnpj: string;
      email: string;
      phone: string;
      city: string;
      state: string;
      primaryColor: string;
      secondaryColor: string;
    };
  };
  header: {
    title: string;
    subtitle?: string;
    organizationName: string;
    documentNumber: string;
  };
  footer: { content: string; generatedAt: string };
  sections: Array<{
    id: string;
    title: string;
    critical?: boolean;
    components: Array<
      | { id: string; kind: 'metadata'; items: Array<{ label: string; value: string }> }
      | { id: string; kind: 'paragraph'; text: string; emphasis?: 'normal' | 'strong' }
      | {
          id: string;
          kind: 'table';
          columns: Array<{ key: string; label: string; width?: number }>;
          rows: Array<Record<string, string>>;
        }
      | { id: string; kind: 'list'; items: string[] }
      | {
          id: string;
          kind: 'image';
          sourceId: string;
          caption: string | null;
          mimeType: string;
          fileSize: number;
        }
      | { id: string; kind: 'qrCode'; label: string; value: string }
      | {
          id: string;
          kind: 'checklist';
          items: Array<{ label: string; done: boolean; note: string | null }>;
        }
      | {
          id: string;
          kind: 'signaturePlaceholder';
          label: string;
          strategy: 'none' | 'fixed' | 'collected' | 'hybrid';
          signedAt: string | null;
        }
      | {
          id: string;
          kind: 'signature';
          mode: 'NONE' | 'FIXED' | 'COLLECTED' | 'HYBRID';
          keepTogether?: boolean;
          signatures: Array<{
            id: string;
            role: 'fixed' | 'collected';
            label: string;
            name: string | null;
            title: string | null;
            signedAt: string | null;
            caption: string | null;
            image?: {
              mimeType: 'image/png' | 'image/jpeg';
              fileSize: number;
              contentBase64: string;
            } | null;
          }>;
        }
      | { id: string; kind: 'observation'; text: string }
    >;
  }>;
};
```

Sprint 8 adicionou o componente `signature`. `signaturePlaceholder` permanece documentado por
compatibilidade, mas o fluxo oficial usa `signature` quando o template exige assinatura.

Comportamento por `signatureMode`:

- `NONE`: nenhuma seção de assinatura é adicionada;
- `FIXED`: inclui assinatura cadastrada e imagem resolvida do storage;
- `COLLECTED`: inclui área manual sem imagem fixa;
- `HYBRID`: inclui assinatura fixa e área manual.

### GET `/api/v1/documents/operations/:operationId/:type/preview`

Roles: `OWNER`, `MANAGER`, `OPERATOR`, `VIEWER` respeitando restrição financeira.

Response 200:

```json
{
  "success": true,
  "data": {
    "version": "1.0",
    "metadata": {
      "operationId": "7db71471-0cf4-4414-8d06-83eb9c1917c9",
      "documentId": "f4ea14f7-859b-452d-b669-e12338d23b39",
      "documentType": "WORK_ORDER",
      "documentNumber": "OS-000001",
      "generatedAt": "2026-06-29T10:00:00.000Z",
      "locale": "pt-BR",
      "timezone": "America/Recife",
      "currency": "BRL",
      "organization": {
        "legalName": "Climatize Nordeste LTDA",
        "tradeName": "Climatize Nordeste",
        "cnpj": "00.000.000/0001-00",
        "email": "contato@example.com",
        "phone": "+55 81 99999-9999",
        "city": "Recife",
        "state": "PE",
        "primaryColor": "#111827",
        "secondaryColor": "#2563EB"
      }
    },
    "header": {
      "title": "Ordem de Serviço",
      "subtitle": "Operação 000001",
      "organizationName": "Climatize Nordeste",
      "documentNumber": "OS-000001"
    },
    "footer": {
      "content": "Gerado por Climatize Nordeste · contato@example.com",
      "generatedAt": "2026-06-29T10:00:00.000Z"
    },
    "sections": []
  }
}
```

### GET `/api/v1/documents/templates/:templateId/preview`

Roles: `OWNER`, `MANAGER`, `OPERATOR`, `VIEWER` respeitando restrição financeira (`QUOTE` e
`RECEIPT` somente `OWNER`).

Gera preview oficial de um `DocumentTemplate` sem `Operation`, sem `Customer`, sem `Equipment` e
sem Demo Dataset. O retorno é o mesmo `DocumentBlueprint` usado pelos demais previews.

Fluxo interno:

```text
DocumentTemplate
↓
DocumentContextService.buildTemplatePreviewContext(templateId)
↓
DocumentBuilder
↓
DocumentBlueprint
↓
DocumentViewer
```

Response 200:

```json
{
  "success": true,
  "data": {
    "version": "1.0",
    "metadata": {
      "operationId": "8498a905-49f1-4e77-99a4-e84e5151f5ed",
      "documentId": null,
      "documentType": "WORK_ORDER",
      "documentNumber": "MODELO-WORK_ORDER",
      "generatedAt": "2026-07-01T10:00:00.000Z",
      "locale": "pt-BR",
      "timezone": "America/Recife",
      "currency": "BRL",
      "organization": {
        "legalName": "Climatize Nordeste LTDA",
        "tradeName": "Climatize Nordeste",
        "cnpj": "00.000.000/0001-00",
        "email": "contato@example.com",
        "phone": "+55 81 99999-9999",
        "city": "Recife",
        "state": "PE",
        "primaryColor": "#111827",
        "secondaryColor": "#2563EB"
      }
    },
    "header": {
      "title": "OS padrão",
      "subtitle": "Pré-visualização de modelo",
      "organizationName": "Climatize Nordeste",
      "documentNumber": "MODELO-WORK_ORDER"
    },
    "footer": {
      "content": "Texto de rodapé do template",
      "generatedAt": "2026-07-01T10:00:00.000Z"
    },
    "sections": []
  }
}
```

Erros principais: common protected errors, `VALIDATION_ERROR`, `TEMPLATE_NOT_FOUND`,
`TEMPLATE_INACTIVE`, `SIGNATURE_NOT_FOUND`, `SIGNATURE_INACTIVE`, `SIGNATURE_IMAGE_REQUIRED`,
`STORAGE_FILE_NOT_FOUND`, `DOCUMENT_FORBIDDEN_TYPE`, `DOCUMENT_SIZE_LIMIT_EXCEEDED`.

### POST `/api/v1/documents/operations/:operationId/:type/render`

Roles: `OWNER`, `MANAGER`, `OPERATOR` respeitando restrição financeira.

Cria o `OperationDocument` caso ainda não exista, renderiza o Blueprint, gera PDF direto, grava no
storage e atualiza metadados.

Response 200:

```json
{
  "success": true,
  "data": {
    "id": "f4ea14f7-859b-452d-b669-e12338d23b39",
    "operationId": "7db71471-0cf4-4414-8d06-83eb9c1917c9",
    "type": "WORK_ORDER",
    "number": "OS-000001",
    "status": "READY",
    "mimeType": "application/pdf",
    "fileSize": 48213,
    "renderedAt": "2026-06-29T10:00:02.000Z",
    "renderMetadata": {
      "engine": "direct-pdf-v1",
      "blueprintVersion": "1.0",
      "pageCount": 3,
      "generatedAt": "2026-06-29T10:00:00.000Z"
    },
    "createdAt": "2026-06-29T09:58:00.000Z",
    "updatedAt": "2026-06-29T10:00:02.000Z",
    "downloadReady": true
  }
}
```

### GET `/api/v1/documents/:documentId/preview`

Roles: `OWNER`, `MANAGER`, `OPERATOR`, `VIEWER` respeitando restrição financeira.

Gera o Blueprint a partir do `OperationDocument` existente.

### POST `/api/v1/documents/:documentId/render`

Roles: `OWNER`, `MANAGER`, `OPERATOR` respeitando restrição financeira.

Renderiza novamente o documento existente. Se já houver PDF anterior, o arquivo antigo é removido
do storage após a nova versão ser salva.

### GET `/api/v1/documents/:documentId/download`

Roles: `OWNER`, `MANAGER`, `OPERATOR`, `VIEWER` respeitando restrição financeira.

Response 200:

```json
{
  "success": true,
  "data": {
    "id": "f4ea14f7-859b-452d-b669-e12338d23b39",
    "operationId": "7db71471-0cf4-4414-8d06-83eb9c1917c9",
    "type": "WORK_ORDER",
    "number": "OS-000001",
    "status": "READY",
    "mimeType": "application/pdf",
    "fileSize": 48213,
    "renderedAt": "2026-06-29T10:00:02.000Z",
    "renderMetadata": { "engine": "direct-pdf-v1", "pageCount": 3 },
    "createdAt": "2026-06-29T09:58:00.000Z",
    "updatedAt": "2026-06-29T10:00:02.000Z",
    "downloadReady": true,
    "contentBase64": "JVBERi0xLjcK..."
  }
}
```

Errors:

| HTTP | Code                           | Condition                              |
| ---- | ------------------------------ | -------------------------------------- |
| 400  | `VALIDATION_ERROR`             | UUID/type inválido                     |
| 400  | `DOCUMENT_SIZE_LIMIT_EXCEEDED` | Blueprint/PDF excede limites           |
| 403  | `DOCUMENT_FORBIDDEN_TYPE`      | Não-OWNER acessando `QUOTE`/`RECEIPT`  |
| 404  | `OPERATION_NOT_FOUND`          | Operation ausente                      |
| 404  | `DOCUMENT_NOT_FOUND`           | OperationDocument ausente              |
| 404  | `ORGANIZATION_NOT_FOUND`       | Seed organizacional/config ausente     |
| 404  | `SIGNATURE_NOT_FOUND`          | Template exige assinatura fixa ausente |
| 409  | `SIGNATURE_INACTIVE`           | Assinatura configurada inativa         |
| 409  | `SIGNATURE_IMAGE_REQUIRED`     | Assinatura fixa sem imagem enviada     |
| 409  | `DOCUMENT_DOWNLOAD_NOT_READY`  | Download solicitado antes do render    |
| 500  | `DOCUMENT_RENDER_FAILED`       | Falha inesperada no render             |

Migrations relacionadas: `20260629110000_document_engine_foundation` e
`20260629150000_document_configuration_signature_domain`. Sprint 8 não cria migration.

## Asset Lifecycle (Sprint 9)

Eventos do ciclo de vida de equipamento são imutáveis. Não existe `PATCH` ou `DELETE` de evento.
Quando um histórico precisa ser corrigido, criar um novo evento do tipo adequado.

Tipos:

```ts
type AssetLifecycleEventType =
  | 'INSTALLATION'
  | 'INSPECTION'
  | 'PREVENTIVE'
  | 'CORRECTIVE'
  | 'MAINTENANCE'
  | 'PART_REPLACEMENT'
  | 'WARRANTY'
  | 'DOCUMENT'
  | 'NOTE'
  | 'CUSTOM';
```

Payload base:

```ts
type AssetLifecycleEvent = {
  id: string;
  equipmentId: string;
  operationId: string | null;
  documentId: string | null;
  type: AssetLifecycleEventType;
  occurredAt: string;
  performedBy: string | null;
  description: string;
  createdAt: string;
  equipment?: {
    id: string;
    name: string;
    tag: string | null;
    type: string;
    status: string;
    customer?: { id: string; name: string; tradeName: string | null } | null;
  };
  operation?: { id: string; number: number; type: string; status: string } | null;
  document?: { id: string; number: string; type: string; status: string } | null;
  performer?: { id: string; name: string; username: string } | null;
  attachments?: AssetLifecycleAttachment[];
  timeline?: AssetLifecycleTimelineItem;
};

type AssetLifecycleTimelineItem = {
  id: string;
  icon: string;
  color: string;
  title: string;
  subtitle: string;
  category: string;
  description: string;
  date: string;
  groupKey: string;
  sortKey: string;
  user: { id: string; name: string; username: string } | null;
  type: AssetLifecycleEventType;
  operationId: string | null;
  documentId: string | null;
  equipmentId: string;
  references: {
    equipment: { id: string; name: string; tag: string; type: string; status: string } | null;
    customer: { id: string; name: string; tradeName: string | null } | null;
    operation: { id: string; number: number; type: string; status: string } | null;
    document: {
      id: string;
      number: string;
      type: string;
      status: string;
      renderedAt: string | null;
      fileSize: number | null;
    } | null;
  };
  attachments: Array<{
    id: string;
    category: string;
    mimeType: string;
    fileSize: number;
    originalFileName: string;
    createdAt: string;
  }>;
  badges: string[];
};

type AssetLifecycleAttachment = {
  id: string;
  originalFileName: string;
  mimeType: 'application/pdf' | 'image/png' | 'image/jpeg';
  fileSize: number;
  category: string;
  createdAt: string;
};
```

Sprint 20.5 removeu campos internos do payload público. O frontend não deve esperar `metadata`,
`storageKey`, `eventId`, `deletedAt` nem e-mail do performer em respostas de Asset Lifecycle. Dados
auxiliares continuam disponíveis pelo objeto seguro `timeline` e pelas referências navegáveis.

### GET `/api/v1/asset-lifecycle`

Roles: `OWNER`, `MANAGER`, `OPERATOR`, `VIEWER`.

Query:

```http
?page=1&limit=20&customerId=<uuid>&equipmentId=<uuid>&operationId=<uuid>&type=PREVENTIVE&performedBy=<uuid>&from=2026-06-01T00:00:00.000Z&to=2026-06-30T23:59:59.999Z
```

Response 200:

```json
{
  "success": true,
  "data": {
    "items": [
      {
        "id": "fdbff227-5bd2-4be8-bb14-8bdfc0fda945",
        "equipmentId": "7e4333fa-7f52-4d61-a9d3-caa3697d3301",
        "operationId": "0d095617-4c7b-45a1-95c1-c8d1a950d587",
        "documentId": null,
        "type": "PREVENTIVE",
        "occurredAt": "2026-06-30T12:00:00.000Z",
        "performedBy": "9ca64187-aecf-4717-8805-16c942133e3d",
        "description": "Preventiva concluída",
        "createdAt": "2026-06-30T12:00:02.000Z",
        "equipment": {
          "id": "7e4333fa-7f52-4d61-a9d3-caa3697d3301",
          "name": "Split 24.000 BTU",
          "tag": "CBV-SPL-001",
          "type": "SPLIT",
          "status": "ACTIVE"
        },
        "operation": {
          "id": "0d095617-4c7b-45a1-95c1-c8d1a950d587",
          "number": 12,
          "type": "PREVENTIVA",
          "status": "COMPLETED"
        },
        "document": null,
        "performer": {
          "id": "9ca64187-aecf-4717-8805-16c942133e3d",
          "name": "João Técnico",
          "username": "joao"
        },
        "attachments": [],
        "timeline": {
          "id": "fdbff227-5bd2-4be8-bb14-8bdfc0fda945",
          "icon": "shield-check",
          "color": "#16A34A",
          "title": "Atendimento #12 · PREVENTIVA",
          "subtitle": "Intervenção planejada/preventiva",
          "category": "maintenance",
          "description": "Preventiva concluída",
          "date": "2026-06-30T12:00:00.000Z",
          "groupKey": "2026-06-30",
          "sortKey": "2026-06-30T12:00:00.000Z_fdbff227-5bd2-4be8-bb14-8bdfc0fda945",
          "user": {
            "id": "9ca64187-aecf-4717-8805-16c942133e3d",
            "name": "João Técnico",
            "username": "joao"
          },
          "type": "PREVENTIVE",
          "operationId": "0d095617-4c7b-45a1-95c1-c8d1a950d587",
          "documentId": null,
          "equipmentId": "7e4333fa-7f52-4d61-a9d3-caa3697d3301",
          "references": {
            "equipment": {
              "id": "7e4333fa-7f52-4d61-a9d3-caa3697d3301",
              "name": "Split 24.000 BTU",
              "tag": "CBV-SPL-001",
              "type": "SPLIT",
              "status": "ACTIVE"
            },
            "customer": {
              "id": "b98be991-9aa5-4721-aeb2-6486e9615cbb",
              "name": "Colégio Boa Viagem",
              "tradeName": "Colégio Boa Viagem"
            },
            "operation": {
              "id": "0d095617-4c7b-45a1-95c1-c8d1a950d587",
              "number": 12,
              "type": "PREVENTIVA",
              "status": "COMPLETED"
            },
            "document": null
          },
          "attachments": [],
          "badges": ["maintenance", "preventive"]
        }
      }
    ],
    "timelineGroups": [
      {
        "date": "2026-06-30",
        "count": 1,
        "items": []
      }
    ],
    "pagination": { "page": 1, "limit": 20, "total": 1, "totalPages": 1 }
  }
}
```

### GET `/api/v1/asset-lifecycle/:id`

Roles: `OWNER`, `MANAGER`, `OPERATOR`, `VIEWER`.

Retorna um `AssetLifecycleEvent` completo com o campo aditivo `timeline`.

### POST `/api/v1/asset-lifecycle`

Roles: `OWNER`, `MANAGER`, `OPERATOR`.

Request:

```json
{
  "equipmentId": "7e4333fa-7f52-4d61-a9d3-caa3697d3301",
  "operationId": "0d095617-4c7b-45a1-95c1-c8d1a950d587",
  "documentId": null,
  "type": "NOTE",
  "occurredAt": "2026-06-30T12:00:00.000Z",
  "performedBy": "9ca64187-aecf-4717-8805-16c942133e3d",
  "description": "Observação técnica registrada no ativo.",
  "metadata": { "source": "field-note" }
}
```

Campos opcionais: `operationId`, `documentId`, `occurredAt`, `performedBy`, `metadata`.

Response 201: `AssetLifecycleEvent`.

### GET `/api/v1/equipments/:id/lifecycle`

Roles: `OWNER`, `MANAGER`, `OPERATOR`, `VIEWER`.

Mesmo contrato de `GET /asset-lifecycle`, com `equipmentId` fixado pelo path. O filtro
`customerId` é ignorado para esta rota quando conflitar com o path.

### GET `/api/v1/equipments/:id/lifecycle/stats`

Roles: `OWNER`, `MANAGER`, `OPERATOR`, `VIEWER`.

Response 200:

```json
{
  "success": true,
  "data": {
    "equipmentId": "7e4333fa-7f52-4d61-a9d3-caa3697d3301",
    "total": 8,
    "byType": {
      "INSTALLATION": 1,
      "INSPECTION": 2,
      "PREVENTIVE": 3,
      "CORRECTIVE": 1,
      "MAINTENANCE": 0,
      "PART_REPLACEMENT": 0,
      "WARRANTY": 0,
      "DOCUMENT": 1,
      "NOTE": 0,
      "CUSTOM": 0
    },
    "preventiveCount": 3,
    "correctiveCount": 1,
    "documentCount": 1,
    "inspectionCount": 2,
    "firstInstallation": "2024-03-15T00:00:00.000Z",
    "lastMaintenance": "2026-06-30T12:00:00.000Z",
    "meanDaysBetweenInterventions": 46.5
  }
}
```

### GET `/api/v1/asset-lifecycle/:id/attachments`

Roles: `OWNER`, `MANAGER`, `OPERATOR`, `VIEWER`.

Retorna apenas anexos ativos (`deletedAt=null`).

### POST `/api/v1/asset-lifecycle/:id/attachments`

Roles: `OWNER`, `MANAGER`, `OPERATOR`.

Content-Type: `multipart/form-data`.

Campos:

- `file`: obrigatório;
- `category`: string, default `DOCUMENT`.

Arquivos aceitos:

- MIME: `application/pdf`, `image/png`, `image/jpeg`;
- extensões: `pdf`, `png`, `jpg`, `jpeg`;
- tamanho máximo: 5 MiB.

Response 201: `AssetLifecycleAttachment`.

### DELETE `/api/v1/asset-lifecycle/:id/attachments/:attachmentId`

Roles: `OWNER`, `MANAGER`.

Soft delete do anexo e remoção best-effort do arquivo físico no storage.

Response 200:

```json
{
  "success": true,
  "data": { "deleted": true }
}
```

Erros:

| HTTP | Code                                   | Condition                                |
| ---- | -------------------------------------- | ---------------------------------------- |
| 400  | `VALIDATION_ERROR`                     | Payload, UUID, query ou relação inválida |
| 400  | `UPLOAD_FILE_REQUIRED`                 | Upload sem arquivo                       |
| 400  | `UPLOAD_FILE_TOO_LARGE`                | Arquivo vazio ou maior que 5 MiB         |
| 400  | `UPLOAD_INVALID_MIME_TYPE`             | MIME ou assinatura binária inválida      |
| 400  | `UPLOAD_INVALID_EXTENSION`             | Extensão não permitida                   |
| 401  | `AUTH_TOKEN_INVALID`                   | Token ausente/inválido                   |
| 403  | `AUTH_FORBIDDEN`                       | Papel sem permissão                      |
| 404  | `ASSET_LIFECYCLE_EVENT_NOT_FOUND`      | Evento ausente                           |
| 404  | `ASSET_LIFECYCLE_ATTACHMENT_NOT_FOUND` | Anexo ausente ou já removido             |
| 404  | `EQUIPMENT_NOT_FOUND`                  | Equipamento ausente                      |
| 404  | `OPERATION_NOT_FOUND`                  | Operation informada ausente              |
| 404  | `DOCUMENT_NOT_FOUND`                   | Documento informado ausente              |

Integrações automáticas:

- ao concluir uma `Operation`, o backend cria evento `INSTALLATION`, `PREVENTIVE`, `CORRECTIVE` ou
  `CUSTOM`, conforme `OperationType`;
- ao renderizar um documento oficial, o backend cria evento `DOCUMENT`;
- ambos são idempotentes e não duplicam histórico se a rota for chamada novamente.

Metadata garantida:

- eventos de Operation: `operationId`, `operationNumber`, `operationType`, `operationStatus`;
- eventos `DOCUMENT`: `documentId`, `documentType`, `documentNumber`, `renderStatus`, `renderedAt`.

Consolidação Sprint 9.5:

- a publicação passa exclusivamente pelo `LifecyclePublisher`;
- a timeline pronta para consumo é gerada pelo `TimelineAssembler`;
- payloads antigos permanecem compatíveis e os campos `timeline`/`timelineGroups` são aditivos.

Migrations: `20260630110000_asset_lifecycle_foundation` e
`20260630130000_asset_lifecycle_refinement`.

## Maintenance Planning

Sprint 10 adiciona planejamento de manutenção. Planejamento não executa atendimento sozinho; a
execução operacional continua sendo `Operation`.

Roles:

- leitura: `OWNER`, `MANAGER`, `OPERATOR`, `VIEWER`;
- criar/editar/desativar planos: `OWNER`, `MANAGER`;
- criar/atualizar execuções planejadas: `OWNER`, `MANAGER`, `OPERATOR`.

Enums:

```ts
type MaintenancePlanType = 'PREVENTIVE' | 'INSPECTION' | 'WARRANTY' | 'CUSTOM';
type MaintenancePriority = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
type MaintenanceExecutionStatus = 'PLANNED' | 'LINKED' | 'COMPLETED' | 'CANCELED';
type RecurrenceFrequency =
  | 'DAILY'
  | 'WEEKLY'
  | 'MONTHLY'
  | 'YEARLY'
  | 'INTERVAL_DAYS'
  | 'INTERVAL_MONTHS';
```

`recurrenceRule`:

```json
{
  "frequency": "MONTHLY",
  "interval": 1
}
```

`interval` é opcional, inteiro de 1 a 3650. Quando ausente, assume 1.

### GET `/api/v1/maintenance-plans/stats`

Response 200:

```json
{
  "success": true,
  "data": {
    "activePlans": 12,
    "overduePlans": 2,
    "upcomingExecutions": 8,
    "completedExecutions": 31,
    "pendingExecutions": 10,
    "meanDaysBetweenExecutions": 28.4
  }
}
```

### GET `/api/v1/maintenance-plans`

Query:

- `page`: default `1`, máximo indireto por `limit`;
- `limit`: default `20`, máximo `100`;
- `equipmentId`: UUID opcional;
- `type`: `MaintenancePlanType`;
- `priority`: `MaintenancePriority`;
- `active`: boolean.

Response 200:

```json
{
  "success": true,
  "data": {
    "items": [
      {
        "id": "9d5ff2e4-7f77-4f05-b07f-075a21a9c0f8",
        "equipmentId": "7e4333fa-7f52-4d61-a9d3-caa3697d3301",
        "name": "Preventiva mensal",
        "description": "Limpeza, inspeção e medição.",
        "type": "PREVENTIVE",
        "active": true,
        "priority": "MEDIUM",
        "recurrenceRule": { "frequency": "MONTHLY", "interval": 1 },
        "firstExecution": "2026-07-10T12:00:00.000Z",
        "nextExecution": "2026-07-10T12:00:00.000Z",
        "lastExecution": null,
        "createdBy": "4f9a4e4a-c3fd-4e2e-b97f-b2b5d4ce5d5c",
        "createdAt": "2026-06-30T15:00:00.000Z",
        "updatedAt": "2026-06-30T15:00:00.000Z",
        "equipment": {
          "id": "7e4333fa-7f52-4d61-a9d3-caa3697d3301",
          "name": "Split Samsung 24.000 BTU",
          "tag": "CBV-SPL-001",
          "type": "SPLIT",
          "status": "ACTIVE",
          "customer": { "id": "20ebef96-bc68-4d3e-9272-7c9383df2232", "name": "Colégio Boa Viagem" }
        },
        "creator": {
          "id": "4f9a4e4a-c3fd-4e2e-b97f-b2b5d4ce5d5c",
          "name": "Darlan Simplicio",
          "username": "ninja"
        },
        "_count": { "executions": 1 }
      }
    ],
    "pagination": { "page": 1, "limit": 20, "total": 1, "totalPages": 1 }
  }
}
```

### GET `/api/v1/maintenance-plans/:id`

Response 200: um `MaintenancePlan` com o mesmo shape da listagem.

### POST `/api/v1/maintenance-plans`

Request:

```json
{
  "equipmentId": "7e4333fa-7f52-4d61-a9d3-caa3697d3301",
  "name": "Preventiva mensal",
  "description": "Limpeza, inspeção e medição.",
  "type": "PREVENTIVE",
  "priority": "MEDIUM",
  "recurrenceRule": { "frequency": "MONTHLY", "interval": 1 },
  "firstExecution": "2026-07-10T12:00:00.000Z",
  "active": true
}
```

Response 201: `MaintenancePlan` criado. A criação do plano também cria uma
`MaintenanceExecution` inicial em `PLANNED` com `scheduledAt = firstExecution`; `nextExecution`
continua apontando para essa próxima execução pendente.

### PATCH `/api/v1/maintenance-plans/:id`

Request parcial:

```json
{
  "name": "Preventiva mensal atualizada",
  "priority": "HIGH",
  "recurrenceRule": { "frequency": "INTERVAL_DAYS", "interval": 45 },
  "firstExecution": "2026-07-15T12:00:00.000Z",
  "active": true
}
```

Response 200: `MaintenancePlan` atualizado.

### DELETE `/api/v1/maintenance-plans/:id`

Desativa o plano (`active=false`). Não remove fisicamente.

Response 200:

```json
{
  "success": true,
  "data": { "deleted": true }
}
```

### GET `/api/v1/maintenance-plans/:id/executions`

Query:

- `page`;
- `limit`;
- `status`;
- `from`;
- `to`.

Response 200:

```json
{
  "success": true,
  "data": {
    "items": [
      {
        "id": "46bd4114-7fb1-4fb8-8061-9dc99383e311",
        "maintenancePlanId": "9d5ff2e4-7f77-4f05-b07f-075a21a9c0f8",
        "operationId": null,
        "scheduledAt": "2026-07-10T12:00:00.000Z",
        "executedAt": null,
        "status": "PLANNED",
        "notes": "Primeira execução planejada.",
        "createdAt": "2026-06-30T15:00:00.000Z",
        "plan": {},
        "operation": null
      }
    ],
    "pagination": { "page": 1, "limit": 20, "total": 1, "totalPages": 1 }
  }
}
```

`plan` usa o mesmo include de `MaintenancePlan`; `operation`, quando presente, contém `id`,
`number`, `type`, `status` e `completedAt`.

### POST `/api/v1/maintenance-plans/:id/executions`

Request:

```json
{
  "scheduledAt": "2026-08-10T12:00:00.000Z",
  "notes": "Execução planejada manualmente."
}
```

`scheduledAt` é opcional. Quando ausente, usa `plan.nextExecution`.

Response 201: `MaintenanceExecution` criada. O plano recalcula `nextExecution` com o
`RecurringEngine`.

### PATCH `/api/v1/maintenance-executions/:id`

Request:

```json
{
  "operationId": "c67bb70d-8d5f-4994-af9a-c206c6ae02ea",
  "status": "COMPLETED",
  "executedAt": "2026-07-10T18:00:00.000Z",
  "notes": "Executada conforme checklist operacional."
}
```

Regras:

- `operationId`, quando informado, deve pertencer ao mesmo equipamento do plano;
- se a Operation vinculada já estiver `COMPLETED`, a execução é concluída;
- ao concluir, o plano atualiza `lastExecution` e `nextExecution`;
- ao concluir, o Asset Lifecycle recebe evento `MAINTENANCE` via `LifecyclePublisher`.

Response 200: `MaintenanceExecution` atualizada.

### GET `/api/v1/equipments/:id/maintenance`

Mesmo contrato de `GET /maintenance-plans`, com `equipmentId` fixado pelo path.

### GET `/api/v1/equipments/:id/maintenance/upcoming`

Mesmo contrato de `GET /maintenance-plans/:id/executions`, filtrado pelo equipamento e, por padrão,
por `status=PLANNED`.

Erros:

| HTTP | Code                              | Condition                                  |
| ---- | --------------------------------- | ------------------------------------------ |
| 400  | `VALIDATION_ERROR`                | Payload/query inválido                     |
| 400  | `MAINTENANCE_RECURRENCE_INVALID`  | Regra de recorrência inválida              |
| 400  | `MAINTENANCE_OPERATION_MISMATCH`  | Operation vinculada pertence a outro ativo |
| 401  | `AUTH_TOKEN_INVALID`              | Token ausente/inválido                     |
| 403  | `AUTH_FORBIDDEN`                  | Papel sem permissão                        |
| 404  | `EQUIPMENT_NOT_FOUND`             | Equipamento ausente                        |
| 404  | `OPERATION_NOT_FOUND`             | Operation vinculada ausente                |
| 404  | `MAINTENANCE_PLAN_NOT_FOUND`      | Plano ausente                              |
| 404  | `MAINTENANCE_EXECUTION_NOT_FOUND` | Execução ausente                           |

Auditoria:

- `MAINTENANCE_PLAN_CREATED`;
- `MAINTENANCE_PLAN_UPDATED`;
- `MAINTENANCE_PLAN_DELETED`;
- `MAINTENANCE_EXECUTION_CREATED`;
- `MAINTENANCE_EXECUTION_UPDATED`;
- `MAINTENANCE_EXECUTION_COMPLETED`.

Migration: `20260630150000_maintenance_planning_domain`.

## PMOC Compliance

Sprint 11 adiciona PMOC como especialização de Maintenance Planning. PMOC não possui recorrência ou
execução própria: usa `MaintenancePlan`, `MaintenanceExecution`, `Operation`, `AssetLifecycle` e
Document Engine.

Roles:

- leitura: `OWNER`, `MANAGER`, `OPERATOR`, `VIEWER`;
- criação/edição/desativação de PMOC e ambientes: `OWNER`, `MANAGER`.

Enums:

```ts
type PmocComplianceStatus = 'COMPLIANT' | 'WARNING' | 'OVERDUE' | 'NON_COMPLIANT' | 'IN_PROGRESS';
```

### GET `/api/v1/pmoc/stats`

Response 200:

```json
{
  "success": true,
  "data": {
    "activePmocs": 8,
    "expiredPmocs": 1,
    "compliantPmocs": 5,
    "pendingPmocs": 2,
    "environments": 22,
    "monitoredEquipments": 14,
    "upcomingExecutions": 6
  }
}
```

### GET `/api/v1/pmoc`

Query:

- `page`;
- `limit`;
- `customerId`;
- `equipmentId`;
- `active`.

Response 200:

```json
{
  "success": true,
  "data": {
    "items": [
      {
        "id": "2b487f6d-4af8-404e-a482-fbc0e52f5207",
        "organizationId": "d8996dbb-a64f-4e51-9a72-951f10c0f36d",
        "customerId": "20ebef96-bc68-4d3e-9272-7c9383df2232",
        "equipmentId": "7e4333fa-7f52-4d61-a9d3-caa3697d3301",
        "maintenancePlanId": "9d5ff2e4-7f77-4f05-b07f-075a21a9c0f8",
        "responsibleTechnician": "Ricardo Almeida",
        "artNumber": "ART-PE-2026-00091",
        "contractNumber": "HSC-PMOC-2026",
        "startDate": "2026-01-01T00:00:00.000Z",
        "endDate": "2026-12-31T00:00:00.000Z",
        "active": true,
        "observations": "PMOC anual",
        "organization": {
          "id": "d8996dbb-a64f-4e51-9a72-951f10c0f36d",
          "legalName": "Climatize Refrigeração LTDA",
          "tradeName": "Climatize"
        },
        "customer": {
          "id": "20ebef96-bc68-4d3e-9272-7c9383df2232",
          "name": "Hospital Santa Clara",
          "tradeName": "Hospital Santa Clara"
        },
        "equipment": {
          "id": "7e4333fa-7f52-4d61-a9d3-caa3697d3301",
          "name": "Chiller Trane 120 TR",
          "tag": "HSC-CHI-001",
          "type": "CHILLER",
          "status": "ACTIVE"
        },
        "maintenancePlan": {
          "id": "9d5ff2e4-7f77-4f05-b07f-075a21a9c0f8",
          "type": "PREVENTIVE",
          "recurrenceRule": { "frequency": "MONTHLY", "interval": 1 },
          "nextExecution": "2026-07-10T12:00:00.000Z",
          "executions": []
        },
        "equipments": [],
        "environments": [],
        "compliance": {
          "status": "COMPLIANT",
          "reasons": [],
          "evaluatedAt": "2026-06-30T18:00:00.000Z"
        }
      }
    ],
    "pagination": { "page": 1, "limit": 20, "total": 1, "totalPages": 1 }
  }
}
```

### GET `/api/v1/pmoc/:id`

Response 200: `PmocPlan` completo com `compliance`, ambientes, equipamentos monitorados,
`MaintenancePlan` e próximas execuções.

### POST `/api/v1/pmoc`

Request:

```json
{
  "customerId": "20ebef96-bc68-4d3e-9272-7c9383df2232",
  "equipmentId": "7e4333fa-7f52-4d61-a9d3-caa3697d3301",
  "equipmentIds": ["7e4333fa-7f52-4d61-a9d3-caa3697d3301"],
  "responsibleTechnician": "Ricardo Almeida",
  "artNumber": "ART-PE-2026-00091",
  "contractNumber": "HSC-PMOC-2026",
  "startDate": "2026-01-01T00:00:00.000Z",
  "endDate": "2026-12-31T00:00:00.000Z",
  "observations": "PMOC anual",
  "priority": "HIGH",
  "recurrenceRule": { "frequency": "MONTHLY", "interval": 1 },
  "active": true
}
```

Response 201: PMOC criado. O backend também cria exatamente um `MaintenancePlan` preventivo e a
primeira `MaintenanceExecution` planejada.

### PATCH `/api/v1/pmoc/:id`

Request parcial:

```json
{
  "responsibleTechnician": "Mariana Costa",
  "equipmentIds": ["7e4333fa-7f52-4d61-a9d3-caa3697d3301"],
  "endDate": "2026-12-31T00:00:00.000Z",
  "recurrenceRule": { "frequency": "INTERVAL_MONTHS", "interval": 1 },
  "active": true
}
```

Response 200: PMOC atualizado.

### DELETE `/api/v1/pmoc/:id`

Desativa PMOC e seu `MaintenancePlan`.

Response 200:

```json
{
  "success": true,
  "data": { "deleted": true }
}
```

### GET `/api/v1/pmoc/:id/environments`

Response 200: lista de ambientes do PMOC com equipamentos relacionados.

### POST `/api/v1/pmoc/:id/environments`

Request:

```json
{
  "name": "Central de água gelada",
  "area": "85 m²",
  "occupancy": 4,
  "equipmentIds": ["7e4333fa-7f52-4d61-a9d3-caa3697d3301"],
  "observations": "Ambiente técnico"
}
```

Response 201: ambiente criado.

### PATCH `/api/v1/pmoc/environments/:id`

Request parcial com os mesmos campos de criação.

Response 200: ambiente atualizado.

### DELETE `/api/v1/pmoc/environments/:id`

Remove o ambiente e seus vínculos.

Response 200:

```json
{
  "success": true,
  "data": { "deleted": true }
}
```

### GET `/api/v1/pmoc/:id/compliance`

Response 200:

```json
{
  "success": true,
  "data": {
    "pmocPlanId": "2b487f6d-4af8-404e-a482-fbc0e52f5207",
    "status": "WARNING",
    "reasons": ["There are upcoming PMOC executions within seven days"],
    "evaluatedAt": "2026-06-30T18:00:00.000Z",
    "document": {
      "type": "PMOC",
      "engine": "DocumentEngine",
      "defaultTemplate": {},
      "ready": true
    }
  }
}
```

### GET `/api/v1/equipments/:id/pmoc`

Mesmo contrato de `GET /pmoc`, filtrado por equipamento principal ou equipamento monitorado.

Erros:

| HTTP | Code                         | Condition                                |
| ---- | ---------------------------- | ---------------------------------------- |
| 400  | `VALIDATION_ERROR`           | Payload/query inválido                   |
| 400  | `PMOC_INVALID_RELATIONSHIP`  | Equipamento não pertence ao cliente/PMOC |
| 401  | `AUTH_TOKEN_INVALID`         | Token ausente/inválido                   |
| 403  | `AUTH_FORBIDDEN`             | Papel sem permissão                      |
| 404  | `CUSTOMER_NOT_FOUND`         | Cliente ausente                          |
| 404  | `EQUIPMENT_NOT_FOUND`        | Equipamento ausente                      |
| 404  | `ORGANIZATION_NOT_FOUND`     | Organização ausente                      |
| 404  | `PMOC_PLAN_NOT_FOUND`        | PMOC ausente                             |
| 404  | `PMOC_ENVIRONMENT_NOT_FOUND` | Ambiente ausente                         |

Eventos automáticos:

- `PMOC_CREATED`;
- `PMOC_UPDATED`;
- `PMOC_EXPIRED`;
- `PMOC_COMPLETED` quando uma execução PMOC é concluída via Maintenance Execution.

Migration: `20260630170000_pmoc_compliance_domain`.

## Inventory & Materials

Sprint 12 adiciona o domínio de inventário e materiais. Todos os endpoints utilizam `/api/v1`,
retornam o envelope padrão `{ "success": true, "data": ... }` e usam o formato global de erro.

Conceitos:

- `Product`: catálogo do produto, sem saldo;
- `InventoryItem`: estoque físico de um produto;
- `StockMovement`: movimentação imutável que altera saldo;
- `Supplier`: fornecedor;
- `OperationPart`: material consumido em uma Operation.

Tipos:

```ts
type StockMovementType = 'IN' | 'OUT' | 'ADJUSTMENT' | 'TRANSFER' | 'CONSUMPTION' | 'RETURN';

type Product = {
  id: string;
  sku: string;
  internalCode?: string | null;
  manufacturerCode?: string | null;
  name: string;
  unit: string;
  brand?: string | null;
  model?: string | null;
  category?: string | null;
  technicalDescription?: string | null;
  weight?: string | null;
  dimensions?: Record<string, unknown> | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  suppliers?: ProductSupplier[];
};

type ProductSupplier = {
  id: string;
  productId: string;
  supplierId: string;
  isPrimary: boolean;
  createdAt: string;
  updatedAt: string;
  supplier: Supplier;
};

type InventoryItem = {
  id: string;
  productId: string;
  currentQuantity: string;
  minimumQuantity: string;
  idealQuantity: string;
  reservedQuantity: string;
  availableQuantity: string;
  location?: string | null;
  isActive: boolean;
  product: Product;
};
```

### GET `/api/v1/products`

Query:

- `page?: number`;
- `limit?: number`;
- `search?: string`;
- `category?: string`;
- `brand?: string`;
- `active?: boolean`.

Response 200:

```json
{
  "success": true,
  "data": {
    "items": [],
    "pagination": { "page": 1, "limit": 20, "total": 0, "totalPages": 0 }
  }
}
```

### GET `/api/v1/products/:id`

Response 200: `Product` com `inventoryItems` e `suppliers`.

### POST `/api/v1/products`

Roles: `OWNER`, `MANAGER`.

```json
{
  "sku": "HVAC-FILTRO-G4-001",
  "internalCode": "MAT-0001",
  "manufacturerCode": "G4-600",
  "name": "Filtro G4 600x600",
  "unit": "UN",
  "brand": "Tecfil",
  "model": "G4",
  "category": "Filtros",
  "technicalDescription": "Filtro para AHU",
  "weight": 1.2,
  "dimensions": "600x600x50",
  "primarySupplierId": "a57b10a6-c070-4955-945f-5e0e6ab32c4c"
}
```

Response 201: produto criado com `inventoryItems` e `suppliers`. O backend cria item de inventário
inicial com saldo zero. Quando `primarySupplierId` é enviado, o fornecedor precisa existir e estar
ativo.

### PATCH `/api/v1/products/:id`

Payload parcial do cadastro. `primarySupplierId: null` remove o fornecedor principal. Response 200:
produto atualizado com relações.

### DELETE `/api/v1/products/:id`

Soft delete. Response 200:

```json
{ "success": true, "data": { "deleted": true } }
```

### GET `/api/v1/inventory`

Query:

- `page?: number`;
- `limit?: number`;
- `search?: string`;
- `productId?: string`;
- `location?: string`;
- `critical?: boolean`;
- `active?: boolean`.

Response 200: lista paginada de `InventoryItem`.

### GET `/api/v1/inventory/:id`

Response 200: `InventoryItem` com produto.

### PATCH `/api/v1/inventory/:id`

Roles: `OWNER`, `MANAGER`.

Permite atualizar parâmetros físicos do item, sem criar movimentação:

```json
{
  "minimumQuantity": 5,
  "idealQuantity": 20,
  "reservedQuantity": 2,
  "location": "Almoxarifado principal",
  "isActive": true
}
```

O saldo disponível é recalculado pelo backend.

### GET `/api/v1/inventory/stats`

Response 200:

```json
{
  "success": true,
  "data": {
    "totalItems": 12,
    "activeProducts": 8,
    "minimumStockAlerts": 2,
    "productsWithoutStock": 1,
    "consumptionMovementsLast30Days": 6,
    "consumptionByPeriod": [],
    "consumptionByEquipment": [],
    "consumptionByCustomer": [],
    "productsMostUsed": []
  }
}
```

### POST `/api/v1/inventory/movements`

Roles: `OWNER`, `MANAGER`, `OPERATOR`.

```json
{
  "inventoryItemId": "f8165f3c-3e6b-4e2a-94a9-71402af96d0b",
  "quantity": 10,
  "type": "IN",
  "reason": "Entrada inicial",
  "operationId": null,
  "occurredAt": "2026-07-01T12:00:00.000Z"
}
```

Response 201: movimentação criada e estoque recalculado.

### GET `/api/v1/inventory/movements`

Query:

- `page?: number`;
- `limit?: number`;
- `inventoryItemId?: string`;
- `productId?: string`;
- `operationId?: string`;
- `type?: StockMovementType`;
- `from?: string`;
- `to?: string`.

Response 200: lista paginada de movimentos. Movimentos não possuem endpoint de edição.

### GET `/api/v1/suppliers`

Roles: `OWNER`, `MANAGER`.

Query: `page`, `limit`, `search`, `active`.

Response 200: lista paginada.

### POST `/api/v1/suppliers`

```json
{
  "legalName": "Friopeças Distribuidora LTDA",
  "tradeName": "Friopeças",
  "document": "12.345.678/0001-90",
  "contacts": [{ "name": "Comercial", "phone": "+55 81 3333-0000" }],
  "address": { "city": "Recife", "state": "PE" },
  "notes": "Fornecedor homologado"
}
```

Response 201: fornecedor criado.

### PATCH `/api/v1/suppliers/:id`

Payload parcial. Response 200: fornecedor atualizado.

### DELETE `/api/v1/suppliers/:id`

Soft delete. Response 200:

```json
{ "success": true, "data": { "deleted": true } }
```

### GET `/api/v1/operations/:id/materials`

Response 200: materiais vinculados à Operation.

### POST `/api/v1/operations/:id/materials`

Roles: `OWNER`, `MANAGER`, `OPERATOR`.

```json
{
  "productId": "1f6ad0fb-24bb-481d-8154-7e22f32c1404",
  "inventoryItemId": "f8165f3c-3e6b-4e2a-94a9-71402af96d0b",
  "quantity": 1,
  "notes": "Substituição de filtro saturado"
}
```

Response 201: cria `OperationPart`, `StockMovement(CONSUMPTION)`, recalcula estoque e publica
`PART_REPLACEMENT` no Asset Lifecycle quando a Operation possui equipamento.

### DELETE `/api/v1/operations/:id/materials/:id`

Roles: `OWNER`, `MANAGER`.

Soft delete do material e criação de `StockMovement(RETURN)`.

Erros:

| HTTP | Code                         | Condition                                     |
| ---- | ---------------------------- | --------------------------------------------- |
| 400  | `VALIDATION_ERROR`           | Payload/query inválido                        |
| 400  | `INVENTORY_NEGATIVE_STOCK`   | Movimentação deixaria saldo negativo          |
| 400  | `INVENTORY_PRODUCT_MISMATCH` | InventoryItem não pertence ao produto enviado |
| 401  | `AUTH_TOKEN_INVALID`         | Token ausente/inválido                        |
| 403  | `AUTH_FORBIDDEN`             | Papel sem permissão                           |
| 404  | `PRODUCT_NOT_FOUND`          | Produto inexistente                           |
| 404  | `SUPPLIER_NOT_FOUND`         | Fornecedor inexistente                        |
| 404  | `INVENTORY_ITEM_NOT_FOUND`   | Item de inventário inexistente                |
| 404  | `OPERATION_NOT_FOUND`        | Operation inexistente                         |
| 409  | `PRODUCT_CONFLICT`           | SKU/código já cadastrado                      |
| 409  | `SUPPLIER_CONFLICT`          | Documento de fornecedor já cadastrado         |

Nota Product↔Supplier:

- `Product` continua sem preço e sem saldo;
- fornecedor principal é persistido via `ProductSupplier`, não em campo direto de `Product`;
- a instalação é single-company, então não há `tenant_id`/`company_id` na relação;
- `primarySupplierId` é validado por UUID, existência e `isActive=true`;
- `GET /products` e `GET /products/:id` retornam `suppliers[]`, ordenados com o primário primeiro.

Eventos de auditoria:

- `PRODUCT_CREATED`, `PRODUCT_UPDATED`, `PRODUCT_DELETED`;
- `SUPPLIER_CREATED`, `SUPPLIER_UPDATED`, `SUPPLIER_DELETED`;
- `INVENTORY_ITEM_CREATED`, `INVENTORY_ITEM_UPDATED`;
- `STOCK_MOVEMENT_CREATED`;
- `MATERIAL_CONSUMED`, `MATERIAL_RETURNED`.

Migration: `20260701120000_inventory_materials_domain`.

## Pricing

Sprint 13 adiciona o domínio oficial de Pricing. Preço e custo não existem em `Product` nem em
`InventoryItem`. A única fonte comercial é `ProductPricing`.

Roles:

- leitura e estatísticas: `OWNER`, `MANAGER`;
- criação/revisão de preços: `OWNER`;
- `OPERATOR` e `VIEWER` não acessam Pricing.

Tipo:

```ts
type ProductPricing = {
  id: string;
  organizationId: string;
  productId: string;
  costPrice: string;
  replacementCost: string;
  averageCost: string;
  salePrice: string;
  minimumSalePrice: string;
  suggestedSalePrice: string;
  marginPercentage: string;
  validFrom: string;
  validUntil?: string | null;
  active: boolean;
  createdAt: string;
  updatedAt: string;
  product: {
    id: string;
    sku: string;
    internalCode?: string | null;
    name: string;
    unit: string;
    brand?: string | null;
    model?: string | null;
    category?: string | null;
    isActive: boolean;
  };
};
```

### GET `/api/v1/pricing/stats`

Query:

- `at?: string`.

Response 200:

```json
{
  "success": true,
  "data": {
    "productsWithoutPrice": 1,
    "expiredPrices": 0,
    "highestMargins": [],
    "lowestMargins": [],
    "averageCost": "55.10",
    "averageSalePrice": "97.33",
    "averageMarginPercentage": "42.80",
    "activePricings": 3,
    "evaluatedAt": "2026-07-01T12:00:00.000Z"
  }
}
```

### GET `/api/v1/pricing`

Query:

- `page?: number`;
- `limit?: number`;
- `productId?: string`;
- `active?: boolean`;
- `at?: string`;
- `expired?: boolean`;
- `search?: string`.

Response 200: lista paginada de `ProductPricing`.

### GET `/api/v1/pricing/:id`

Response 200: `ProductPricing`.

### GET `/api/v1/products/:id/pricing`

Resolve o preço vigente do produto.

Response 200:

```json
{
  "success": true,
  "data": {
    "pricingId": "3ffbc3d5-88e2-4241-9d13-e3f43b322ac8",
    "organizationId": "f398fb45-16d3-4278-b531-2c4e16a5297b",
    "productId": "4d375bb8-151f-4e84-b151-7a0c57a8cb93",
    "costPrice": "42.50",
    "replacementCost": "45.00",
    "averageCost": "43.80",
    "salePrice": "78.00",
    "minimumSalePrice": "68.00",
    "suggestedSalePrice": "82.00",
    "marginPercentage": "43.85",
    "validFrom": "2026-07-01T00:00:00.000Z",
    "validUntil": null,
    "active": true,
    "resolvedAt": "2026-07-01T12:00:00.000Z"
  }
}
```

### POST `/api/v1/products/:id/pricing`

Cria uma nova vigência de preço para o produto. Vigências ativas sobrepostas são rejeitadas.

```json
{
  "costPrice": 42.5,
  "replacementCost": 45,
  "averageCost": 43.8,
  "salePrice": 78,
  "minimumSalePrice": 68,
  "suggestedSalePrice": 82,
  "validFrom": "2026-07-01T00:00:00.000Z",
  "validUntil": null,
  "active": true
}
```

`marginPercentage` é opcional. Quando omitido, o backend calcula a margem a partir de
`salePrice` e `averageCost`.

Response 201: `ProductPricing` criado.

### PATCH `/api/v1/pricing/:id`

Cria uma revisão histórica baseada no preço anterior. Não sobrescreve valores comerciais antigos.

Payload parcial:

```json
{
  "salePrice": 84,
  "minimumSalePrice": 72,
  "suggestedSalePrice": 88,
  "validFrom": "2026-08-01T00:00:00.000Z"
}
```

Response 200: nova revisão criada. O registro anterior é desativado e sua vigência é encerrada.

### GET `/api/v1/pricing/history/:productId`

Query: `page`, `limit`.

Response 200: evolução paginada de preços do produto, ordenada por `validFrom desc`.

Erros:

| HTTP | Code                     | Condition                            |
| ---- | ------------------------ | ------------------------------------ |
| 400  | `VALIDATION_ERROR`       | Payload/query inválido               |
| 400  | `PRICING_INVALID_MARGIN` | Preço/margem comercial inconsistente |
| 400  | `PRICING_INVALID_PERIOD` | Vigência inválida                    |
| 401  | `AUTH_TOKEN_INVALID`     | Token ausente/inválido               |
| 403  | `AUTH_FORBIDDEN`         | Papel sem permissão                  |
| 404  | `PRODUCT_NOT_FOUND`      | Produto inexistente/inativo          |
| 404  | `PRICING_NOT_FOUND`      | Registro/preço vigente inexistente   |
| 409  | `PRICING_OVERLAP`        | Vigência sobreposta a preço ativo    |

Eventos de auditoria:

- `PRICING_CREATED`;
- `PRICING_UPDATED`;
- `PRICING_DEACTIVATED`.

Migration: `20260701150000_pricing_domain`.

## Assignments (execução operacional)

`Assignment` é a camada oficial de execução da `Operation`. Não cria agenda paralela nem OS
paralela: controla responsável, aceite, início, conclusão e histórico operacional.

Endpoints:

| Método | Rota                                | Roles                         | Descrição                                                  |
| ------ | ----------------------------------- | ----------------------------- | ---------------------------------------------------------- |
| GET    | `/assignments`                      | OWNER/MANAGER/OPERATOR/VIEWER | Lista paginada. OPERATOR vê apenas as próprias Assignments |
| GET    | `/assignments/my`                   | OWNER/MANAGER/OPERATOR        | Fila do usuário autenticado                                |
| GET    | `/assignments/:id`                  | OWNER/MANAGER/OPERATOR/VIEWER | Detalhe da Assignment                                      |
| GET    | `/assignments/history/:operationId` | OWNER/MANAGER/OPERATOR/VIEWER | Histórico imutável da Operation                            |
| POST   | `/assignments`                      | OWNER/MANAGER                 | Cria Assignment para Operation existente                   |
| PATCH  | `/assignments/:id/reassign`         | OWNER/MANAGER                 | Reatribui responsável                                      |
| PATCH  | `/assignments/:id/accept`           | OWNER/MANAGER/OPERATOR        | Operador responsável aceita                                |
| PATCH  | `/assignments/:id/reject`           | OWNER/MANAGER/OPERATOR        | Operador responsável recusa                                |
| PATCH  | `/assignments/:id/start`            | OWNER/MANAGER/OPERATOR        | Inicia execução após aceite                                |
| PATCH  | `/assignments/:id/complete`         | OWNER/MANAGER/OPERATOR        | Conclui execução após início                               |

Query listagem: `page`, `limit`, `operationId`, `assignedTo`, `customerId`, `equipmentId`, `status`.

Statuses: `ASSIGNED`, `ACCEPTED`, `STARTED`, `PAUSED`, `COMPLETED`, `CANCELED`, `REJECTED`.

Eventos de histórico: `ASSIGNED`, `REASSIGNED`, `ACCEPTED`, `STARTED`, `PAUSED`, `RESUMED`,
`REJECTED`, `COMPLETED`, `CANCELED`.

Payloads:

```json
{ "operationId": "<uuid>", "assignedTo": "<uuid>", "notes": "opcional" }
```

```json
{ "assignedTo": "<uuid>", "notes": "motivo opcional" }
```

```json
{ "rejectionReason": "Motivo da recusa" }
```

```json
{ "notes": "Observação final opcional" }
```

Regras:

- criação de `Operation` cria uma `Assignment` automaticamente;
- `OWNER`/`MANAGER` podem criar e reatribuir;
- somente o `assignedTo` pode aceitar, recusar, iniciar ou concluir;
- iniciar exige status `ACCEPTED`;
- concluir exige status `STARTED`;
- concluir Assignment atualiza a Operation para `COMPLETED` e dispara integrações existentes.

Erros:

| HTTP | Code                            | Condition                                             |
| ---- | ------------------------------- | ----------------------------------------------------- |
| 400  | `VALIDATION_ERROR`              | Payload/query inválido                                |
| 400  | `OPERATION_OPERATOR_INVALID`    | Operador inválido/inativo/sem perfil operacional      |
| 403  | `ASSIGNMENT_OPERATOR_FORBIDDEN` | Operador tentando agir em Assignment de outro usuário |
| 404  | `ASSIGNMENT_NOT_FOUND`          | Assignment inexistente                                |
| 404  | `OPERATION_NOT_FOUND`           | Operation inexistente                                 |
| 409  | `ASSIGNMENT_INVALID_TRANSITION` | Estado atual não permite transição                    |

Migration: `20260701170000_assignment_domain`.

## Budgets

Domínio comercial oficial de orçamentos. Todas as rotas exigem JWT e usam envelope global.

Roles:

- `OWNER` e `MANAGER`: acesso completo ao domínio Budget;
- `OPERATOR` e `VIEWER`: sem acesso aos endpoints de Budget.

Statuses: `DRAFT`, `PENDING`, `APPROVED`, `REJECTED`, `EXPIRED`, `CANCELED`.

### GET `/api/v1/budgets`

Query: `page`, `limit`, `search`, `status`, `customerId`, `equipmentId`, `operationId`,
`from`, `to`, `expired`.

Response 200:

```json
{
  "items": [
    {
      "id": "uuid",
      "number": 1,
      "status": "PENDING",
      "title": "Orçamento de manutenção HVAC",
      "subtotal": "301.00",
      "discount": "0.00",
      "additional": "0.00",
      "total": "301.00",
      "expirationDate": "2026-07-17T00:00:00.000Z",
      "customer": { "id": "uuid", "name": "Hospital Santa Clara" },
      "equipment": { "id": "uuid", "name": "Split 24.000 BTU" },
      "operation": { "id": "uuid", "number": 42, "type": "CORRETIVA", "status": "DRAFT" },
      "items": []
    }
  ],
  "pagination": { "page": 1, "limit": 20, "total": 1, "totalPages": 1 }
}
```

### GET `/api/v1/budgets/:id`

Response 200: `Budget` completo com `items`, `approvals`, `customer`, `equipment`,
`operation`, `creator` e snapshots comerciais.

### GET `/api/v1/operations/:id/budgets`

Lista paginada dos orçamentos vinculados à Operation.

### POST `/api/v1/budgets`

Cria orçamento comercial com itens documentais independentes. O contrato DC-06 detalhado ao fim desta seção substitui o antigo vínculo obrigatório com `Product`/`PricingService`.

Payload:

```json
{
  "operationId": "uuid-opcional",
  "customerId": "uuid",
  "customerAddressId": "uuid-opcional",
  "equipmentId": "uuid-opcional",
  "title": "Troca de componentes",
  "description": "Proposta para manutenção corretiva",
  "discount": 0,
  "additional": 0,
  "issuedAt": "2026-06-17T00:00:00.000Z",
  "introduction": "Atendendo à honrosa solicitação de V.Sa., apresentamos nosso orçamento conforme solicitado.",
  "validityDays": 30,
  "paymentMethods": ["PIX"],
  "observations": "Condições comerciais",
  "status": "PENDING",
  "items": [{ "type": "MATERIAL", "description": "Filtro G4", "quantity": 2, "unit": "UN", "unitPrice": 78 }]
}
```

Response 201: Budget criado. Cada item retorna:

```json
{
  "productId": null,
  "type": "MATERIAL",
  "description": "Filtro G4",
  "quantity": "2.000",
  "unit": "UN",
  "unitPrice": "78.00",
  "total": "156.00"
}
```

### PATCH `/api/v1/budgets/:id`

Atualiza orçamento editável. Enviar `items` substitui a lista inteira e recalcula os totais no backend.
Orçamentos `APPROVED`, `REJECTED`, `EXPIRED` ou `CANCELED` não são editáveis.

Payload parcial:

```json
{
  "title": "Troca de componentes revisada",
  "discount": 25,
  "items": [{ "type": "MATERIAL", "description": "Filtro G4", "quantity": 3, "unit": "UN", "unitPrice": 78 }]
}
```

### PATCH `/api/v1/budgets/:id/approve`

Payload:

```json
{ "observation": "Aprovado pelo cliente" }
```

Regras:

- apenas `DRAFT` ou `PENDING` podem ser aprovados;
- orçamento vencido não pode ser aprovado;
- somente um Budget por Operation pode ficar `APPROVED`;
- publica `BUDGET_APPROVED` no Asset Lifecycle quando há equipamento.

### PATCH `/api/v1/budgets/:id/reject`

Payload:

```json
{ "observation": "Cliente solicitou revisão futura" }
```

Publica `BUDGET_REJECTED` no Asset Lifecycle quando há equipamento.

### DELETE `/api/v1/budgets/:id`

Cancela orçamento editável. Response 200:

```json
{ "deleted": true }
```

### GET `/api/v1/budgets/stats`

Query igual à listagem.

Response 200:

```json
{
  "total": 12,
  "approved": 4,
  "rejected": 2,
  "pending": 3,
  "potentialRevenue": "4820.00",
  "averageTicket": "1205.00"
}
```

### GET `/api/v1/budgets/history/:id`

Retorna histórico imutável paginado do orçamento.

Erros:

| HTTP | Code                          | Condition                                           |
| ---- | ----------------------------- | --------------------------------------------------- |
| 400  | `VALIDATION_ERROR`            | Payload/query inválido ou total negativo            |
| 400  | `BUDGET_INVALID_RELATIONSHIP` | Customer/address/equipment/operation inconsistentes |
| 400  | `BUDGET_ITEM_REQUIRED`        | Orçamento sem itens                                 |
| 400  | `BUDGET_INVALID_STATUS`       | Status inválido para criação/alteração/decisão      |
| 401  | `UNAUTHORIZED`                | Token ausente/inválido                              |
| 403  | `FORBIDDEN`                   | Papel sem permissão                                 |
| 404  | `BUDGET_NOT_FOUND`            | Budget inexistente                                  |
| 404  | `CUSTOMER_NOT_FOUND`          | Cliente inexistente/inativo                         |
| 404  | `EQUIPMENT_NOT_FOUND`         | Equipamento inexistente/inativo                     |
| 404  | `OPERATION_NOT_FOUND`         | Operation inexistente                               |
| 404  | `PRODUCT_NOT_FOUND`           | Produto inexistente/inativo                         |
| 404  | `PRICING_NOT_FOUND`           | Produto sem preço vigente                           |
| 409  | `BUDGET_APPROVED_IMMUTABLE`   | Tentativa de alterar orçamento aprovado             |
| 409  | `BUDGET_EXPIRED`              | Tentativa de aprovar orçamento vencido              |
| 409  | `BUDGET_MULTIPLE_APPROVAL`    | Já existe Budget aprovado para a Operation          |
| 409  | `BUDGET_OPERATION_NOT_COMPLETED` | Origem informada não é uma Ordem de Serviço concluída |

Eventos de auditoria:

- `BUDGET_CREATED`;
- `BUDGET_UPDATED`;
- `BUDGET_APPROVED`;
- `BUDGET_REJECTED`;
- `BUDGET_CANCELED`.

Migration: `20260702100000_budget_domain`.

## Backlog — Budget Document Emission

O Budget agora emite documento oficial pelo Document Engine. O domínio Budget não chama
`DocumentBuilder` diretamente; a emissão passa por `DocumentEngineService`, cria/atualiza um
`OperationDocument` vinculado ao `budgetId` e usa os snapshots dos `BudgetItem`.

### POST `/api/v1/budgets/:id/render`

Emite ou reemite o PDF oficial do orçamento.

Access: `OWNER`, `MANAGER`.

Response 200:

```json
{
  "documentId": "uuid",
  "preview": {
    "version": "1.0",
    "metadata": {
      "operationId": "uuid|null",
      "budgetId": "uuid",
      "documentId": "uuid",
      "documentType": "BUDGET",
      "documentNumber": "ORC-000123"
    },
    "sections": []
  },
  "download": "/api/v1/budgets/{id}/download",
  "status": "READY",
  "document": {
    "id": "uuid",
    "operationId": "uuid|null",
    "budgetId": "uuid",
    "type": "BUDGET",
    "number": "ORC-000123",
    "status": "READY",
    "mimeType": "application/pdf",
    "fileSize": 12345,
    "renderedAt": "2026-07-02T12:00:00.000Z",
    "downloadReady": true
  }
}
```

Efeitos colaterais:

- cria/atualiza `OperationDocument`;
- salva PDF via storage do Document Engine;
- registra `BudgetHistory.DOCUMENT_RENDERED`;
- registra auditoria `DOCUMENT_RENDERED`;
- publica Asset Lifecycle `DOCUMENT_RENDERED` quando houver equipamento resolvido.

### GET `/api/v1/budgets/:id/download`

Baixa o PDF oficial já emitido.

Access: `OWNER`, `MANAGER`.

Response 200:

```json
{
  "id": "uuid",
  "operationId": "uuid|null",
  "budgetId": "uuid",
  "type": "BUDGET",
  "number": "ORC-000123",
  "status": "READY",
  "mimeType": "application/pdf",
  "fileSize": 12345,
  "renderedAt": "2026-07-02T12:00:00.000Z",
  "downloadReady": true,
  "contentBase64": "JVBERi0x..."
}
```

Erros adicionais:

| HTTP | Code                          | Condition                                         |
| ---- | ----------------------------- | ------------------------------------------------- |
| 403  | `DOCUMENT_FORBIDDEN_TYPE`     | Papel sem permissão para documento comercial      |
| 404  | `BUDGET_NOT_FOUND`            | Budget inexistente                                |
| 404  | `DOCUMENT_NOT_FOUND`          | Download solicitado antes da emissão              |
| 409  | `BUDGET_INVALID_STATUS`       | Budget cancelado ou rejeitado                     |
| 409  | `DOCUMENT_DOWNLOAD_NOT_READY` | Documento existe, mas ainda não possui PDF pronto |
| 500  | `DOCUMENT_RENDER_FAILED`      | Falha segura no render/PDF                        |

Migration: `20260702120000_budget_document_emission`.

## Financial Core

Financial é o único domínio autorizado a representar dinheiro operacional no Orbit V1.

Todos os endpoints exigem `OWNER` ou `MANAGER`. `OPERATOR` e `VIEWER` recebem `403`.

### Financial enums

```ts
type FinancialAccountType = 'CASH' | 'BANK' | 'CREDIT_CARD' | 'DIGITAL_WALLET' | 'OTHER';
type FinancialCategoryType = 'INCOME' | 'EXPENSE' | 'TRANSFER';
type FinancialEntryType = 'RECEIVABLE' | 'PAYABLE' | 'TRANSFER';
type FinancialEntryStatus = 'PENDING' | 'PAID' | 'CANCELED' | 'OVERDUE';
type FinancialEntryOrigin = 'MANUAL' | 'BUDGET' | 'PURCHASE' | 'OPERATION' | 'PMOC' | 'OTHER';
```

### GET `/api/v1/financial/accounts`

Query: `page`, `limit`, `search`, `type`, `active`.

Response 200: paginado com `FinancialAccount`.

### POST `/api/v1/financial/accounts`

```json
{
  "name": "Banco principal",
  "type": "BANK",
  "description": "Conta operacional",
  "openingBalance": 8500,
  "active": true
}
```

### PATCH `/api/v1/financial/accounts/:id`

Campos opcionais: `name`, `type`, `description`, `active`.

### DELETE `/api/v1/financial/accounts/:id`

Soft delete. Response:

```json
{ "deleted": true }
```

### GET `/api/v1/financial/categories`

Query: `page`, `limit`, `search`, `type`, `active`.

### POST `/api/v1/financial/categories`

```json
{
  "name": "Serviços técnicos",
  "type": "INCOME",
  "color": "#16A34A",
  "icon": "wrench",
  "active": true
}
```

### PATCH `/api/v1/financial/categories/:id`

Campos opcionais: `name`, `type`, `color`, `icon`, `active`.

### DELETE `/api/v1/financial/categories/:id`

Soft delete. Response:

```json
{ "deleted": true }
```

### GET `/api/v1/financial/entries`

Query:

- `page`;
- `limit`;
- `search`;
- `accountId`;
- `categoryId`;
- `type`;
- `origin`;
- `status`;
- `from`;
- `to`.

### GET `/api/v1/financial/entries/:id`

Retorna lançamento com conta, categoria, criador e allocations.

### POST `/api/v1/financial/entries`

```json
{
  "accountId": "uuid",
  "categoryId": "uuid",
  "type": "RECEIVABLE",
  "origin": "BUDGET",
  "originId": "uuid",
  "amount": 1250,
  "dueDate": "2026-07-10T00:00:00.000Z",
  "description": "Recebimento previsto",
  "notes": "Opcional",
  "status": "PENDING"
}
```

Regras:

- `RECEIVABLE` exige categoria `INCOME`;
- `PAYABLE` exige categoria `EXPENSE`;
- `TRANSFER` exige categoria `TRANSFER`;
- `CANCELED` e `OVERDUE` não podem ser status inicial;
- `PAID` inicial atualiza saldo imediatamente.

### PATCH `/api/v1/financial/entries/:id`

Edita lançamentos não finais. Campos opcionais:

- `accountId`;
- `categoryId`;
- `type`;
- `origin`;
- `originId`;
- `amount`;
- `dueDate`;
- `description`;
- `notes`.

### PATCH `/api/v1/financial/entries/:id/pay`

```json
{
  "paidAt": "2026-07-02T12:00:00.000Z",
  "notes": "Pago em dinheiro"
}
```

Regras:

- pagamento duplicado retorna `FINANCIAL_ENTRY_INVALID_STATE`;
- lançamento cancelado não pode ser pago;
- saldo da conta é atualizado em transação.

### PATCH `/api/v1/financial/entries/:id/cancel`

```json
{
  "reason": "Lançamento criado incorretamente"
}
```

Regras:

- lançamento pago não pode ser cancelado na V1;
- lançamento já cancelado retorna `FINANCIAL_ENTRY_INVALID_STATE`.

### GET `/api/v1/financial/stats`

Response 200:

```json
{
  "receivableToday": "1250.00",
  "payableToday": "320.00",
  "overdue": {
    "receivable": "0.00",
    "payable": "0.00"
  },
  "currentBalance": "10000.00",
  "projectedBalance": "10930.00",
  "income": "0.00",
  "expenses": "0.00",
  "monthlyFlow": [
    {
      "month": "2026-07",
      "income": "1250.00",
      "expenses": "320.00",
      "net": "930.00"
    }
  ]
}
```

### GET `/api/v1/financial/history/:id`

Histórico imutável paginado de um lançamento.

Erros:

| HTTP | Code                             | Condition                                       |
| ---- | -------------------------------- | ----------------------------------------------- |
| 400  | `FINANCIAL_INVALID_RELATIONSHIP` | Categoria não corresponde ao tipo do lançamento |
| 400  | `VALIDATION_ERROR`               | Payload/query inválido                          |
| 403  | `FORBIDDEN`                      | Papel sem permissão financeira                  |
| 404  | `FINANCIAL_ACCOUNT_NOT_FOUND`    | Conta inexistente/inativa                       |
| 404  | `FINANCIAL_CATEGORY_NOT_FOUND`   | Categoria inexistente/inativa                   |
| 404  | `FINANCIAL_ENTRY_NOT_FOUND`      | Lançamento inexistente                          |
| 409  | `FINANCIAL_ENTRY_INVALID_STATE`  | Transição inválida                              |

Migration: `20260702160000_financial_core`.

## Procurement & Purchasing

Domínio oficial de compras da V1. Todos os endpoints exigem `OWNER` ou `MANAGER`.

### Enums

```ts
type PurchaseOrderStatus = 'DRAFT' | 'SENT' | 'PARTIALLY_RECEIVED' | 'RECEIVED' | 'CANCELED';
type PurchaseHistoryAction =
  | 'CREATED'
  | 'UPDATED'
  | 'SENT'
  | 'PARTIALLY_RECEIVED'
  | 'RECEIVED'
  | 'CANCELED';
```

### GET `/api/v1/purchase-orders`

Query: `page`, `limit`, `search`, `supplierId`, `status`, `from`, `to`.

### GET `/api/v1/purchase-orders/:id`

Retorna pedido com fornecedor, itens, últimos recebimentos e criador.

### POST `/api/v1/purchase-orders`

```json
{
  "supplierId": "uuid",
  "expectedDelivery": "2026-07-15T00:00:00.000Z",
  "notes": "Compra de reposição"
}
```

### PATCH `/api/v1/purchase-orders/:id`

Edita pedidos `DRAFT` ou `SENT`.

### PATCH `/api/v1/purchase-orders/:id/send`

Muda `DRAFT` para `SENT`. Exige pelo menos um item.

### PATCH `/api/v1/purchase-orders/:id/cancel`

Cancela pedido ainda não recebido.

### GET `/api/v1/purchase-orders/:id/items`

Lista itens ativos do pedido.

### POST `/api/v1/purchase-orders/:id/items`

```json
{
  "productId": "uuid",
  "quantity": 10,
  "unit": "UN",
  "snapshotCost": 42.5,
  "snapshotDescription": "Filtro G4"
}
```

Snapshots são obrigatórios para custo/descrição. Renderizações futuras não dependem do Product.

### PATCH `/api/v1/purchase-order-items/:id`

Edita item ainda não recebido.

### DELETE `/api/v1/purchase-order-items/:id`

Soft delete de item ainda não recebido.

### GET `/api/v1/purchase-orders/:id/receipts`

Lista recebimentos do pedido.

### POST `/api/v1/purchase-orders/:id/receipts`

```json
{
  "receivedAt": "2026-07-02T12:00:00.000Z",
  "notes": "Recebimento parcial",
  "items": [{ "itemId": "uuid", "quantity": 4 }]
}
```

Efeitos:

- cria `PurchaseReceipt`;
- atualiza `receivedQuantity`;
- altera status para `PARTIALLY_RECEIVED` ou `RECEIVED`;
- cria `StockMovement(IN)` via Inventory;
- recalcula estoque pelo Inventory;
- cria `PurchaseHistory`.

### GET `/api/v1/purchase-orders/stats`

Retorna totais por status.

### GET `/api/v1/purchase-orders/history/:id`

Histórico imutável paginado.

Erros:

| HTTP | Code                       | Condition                         |
| ---- | -------------------------- | --------------------------------- |
| 400  | `VALIDATION_ERROR`         | Payload/query inválido            |
| 403  | `FORBIDDEN`                | Papel sem permissão               |
| 404  | `PURCHASE_ORDER_NOT_FOUND` | Pedido inexistente                |
| 404  | `PURCHASE_ITEM_NOT_FOUND`  | Item inexistente                  |
| 404  | `SUPPLIER_NOT_FOUND`       | Fornecedor inexistente/inativo    |
| 404  | `PRODUCT_NOT_FOUND`        | Produto inexistente/inativo       |
| 409  | `PURCHASE_INVALID_STATE`   | Transição inválida                |
| 409  | `PURCHASE_INVALID_RECEIPT` | Quantidade recebida excede compra |

Migration: `20260702180000_procurement_domain`.

## Sprint 19 — Integrity semantics and conflict behavior

No endpoint path or payload shape changed in Sprint 19. The backend now enforces stricter
concurrency semantics for existing commands. Clients must treat the following conflicts as stable
business responses and refresh the resource before retrying.

### Financial

Affected endpoints:

- `PATCH /api/v1/financial/entries/:id/pay`;
- `PATCH /api/v1/financial/entries/:id/cancel`.

Behavior:

- payment is accepted only if the entry is still payable at commit time;
- cancellation is accepted only if the entry is still cancelable at commit time;
- account balance is updated in the same transaction as status/history/audit/lifecycle.

Conflict:

| HTTP | Code                            | Condition                                                                         |
| ---- | ------------------------------- | --------------------------------------------------------------------------------- |
| 409  | `FINANCIAL_ENTRY_INVALID_STATE` | Duplicate payment, stale payment, paid entry cancellation, or payment/cancel race |

### Inventory and Operation Materials

Affected endpoints:

- `POST /api/v1/inventory/movements`;
- `POST /api/v1/operations/:id/materials`;
- `DELETE /api/v1/operations/:id/materials/:id`.

Behavior:

- negative stock movements are guarded by conditional balance updates;
- `StockMovement` is created only after the inventory delta is accepted;
- duplicate material removal cannot create duplicate `RETURN` movements.

Conflict:

| HTTP | Code                       | Condition                                            |
| ---- | -------------------------- | ---------------------------------------------------- |
| 409  | `INVENTORY_NEGATIVE_STOCK` | Movement would make current/available stock negative |
| 409  | `NOT_FOUND`                | Operation material was already removed               |

### Procurement

Affected endpoint:

- `POST /api/v1/purchase-orders/:id/receipts`.

Behavior:

- receipt processing revalidates order status and item quantities inside the transaction;
- `receivedQuantity`, `PurchaseReceipt`, `StockMovement(IN)`, status, history and audit are atomic;
- concurrent over-receipt attempts fail safely.

Conflict:

| HTTP | Code                       | Condition                                                                   |
| ---- | -------------------------- | --------------------------------------------------------------------------- |
| 409  | `PURCHASE_INVALID_RECEIPT` | Quantity exceeds remaining purchase quantity or concurrent receipt conflict |
| 409  | `PURCHASE_INVALID_STATE`   | Order state changed while receiving                                         |

### Assignments

Affected endpoints:

- `PATCH /api/v1/assignments/:id/reassign`;
- `PATCH /api/v1/assignments/:id/accept`;
- `PATCH /api/v1/assignments/:id/reject`;
- `PATCH /api/v1/assignments/:id/start`;
- `PATCH /api/v1/assignments/:id/complete`.

Behavior:

- transition requires the same `status` and `assignedTo` at commit time;
- stale operator actions after reassignment fail with conflict;
- Assignment history remains append-only.

Conflict:

| HTTP | Code                            | Condition                                          |
| ---- | ------------------------------- | -------------------------------------------------- |
| 409  | `ASSIGNMENT_INVALID_TRANSITION` | Duplicate, stale, or invalid Assignment transition |

### Budgets

Affected endpoints:

- `PATCH /api/v1/budgets/:id/approve`;
- `PATCH /api/v1/budgets/:id/reject`;
- `DELETE /api/v1/budgets/:id`.

Behavior:

- decisions require the same status at commit time;
- only one approved Budget per Operation is enforced by PostgreSQL partial unique index;
- final budgets remain immutable.

Conflict:

| HTTP | Code                       | Condition                                            |
| ---- | -------------------------- | ---------------------------------------------------- |
| 409  | `BUDGET_INVALID_STATUS`    | Duplicate/stale approval, rejection or cancellation  |
| 409  | `BUDGET_MULTIPLE_APPROVAL` | Another Budget is already approved for the Operation |

### Pricing

Affected endpoints:

- `POST /api/v1/products/:id/pricing`;
- `PATCH /api/v1/pricing/:id`.

Behavior:

- active pricing validity ranges for the same product/organization cannot overlap;
- enforcement exists both in service transaction and database exclusion constraint.

Conflict:

| HTTP | Code              | Condition                                                           |
| ---- | ----------------- | ------------------------------------------------------------------- |
| 409  | `PRICING_OVERLAP` | Active pricing range overlaps another active range or revision race |

### Document Engine

Affected endpoints:

- `POST /api/v1/documents/:documentId/render`;
- `POST /api/v1/budgets/:id/render`.

Behavior:

- Budget still has a single official `OperationDocument` via `budgetId`;
- render metadata write is conditional on the document not changing during render;
- if a competing render wins, the newly-created binary is deleted and the request fails safely.

Conflict:

| HTTP | Code                     | Condition                                           |
| ---- | ------------------------ | --------------------------------------------------- |
| 409  | `DOCUMENT_RENDER_FAILED` | Document changed while rendering; refresh and retry |

## Sprint 19.5 — verified PostgreSQL behavior

No contract shape changed. The following runtime behaviors are now backed by real PostgreSQL
integration/concurrency tests:

- `PATCH /financial/entries/:id/pay`
  - duplicate payment commits once;
  - independent concurrent payments to the same account are retried safely on PostgreSQL `P2034`;
  - final balance uses exact Decimal persistence.
- `PATCH /financial/entries/:id/cancel`
  - payment/cancel race ends in one coherent terminal state.
- `POST /operations/:id/materials`
  - overspend attempts cannot commit both when stock is insufficient.
- `DELETE /operations/:id/materials/:id`
  - duplicate return applies once.
- `POST /purchase-orders/:id/receipts`
  - concurrent over-receipt cannot exceed purchased quantity.
- Assignment transition endpoints
  - stale assignee transition loses against committed reassignment.
- Budget approval endpoints
  - duplicate approval commits once;
  - database prevents more than one approved Budget per Operation.
- Pricing endpoints
  - PostgreSQL exclusion constraint rejects active overlapping validity ranges.

Developer verification commands:

```bash
TEST_DATABASE_URL='postgresql://user:pass@127.0.0.1:5432/orbit_integrity_test?schema=public' npm run test:integration
TEST_DATABASE_URL='postgresql://user:pass@127.0.0.1:5432/orbit_integrity_test?schema=public' npm run test:concurrency
```

Safety rule: `TEST_DATABASE_URL` database name must end with `_test`.

## Sprint 19.6 — integrity closure semantics

Pricing validity:

- períodos ativos são half-open: `[validFrom, validUntil)`;
- `validUntil == next.validFrom` é adjacência válida;
- preço open-ended (`validUntil = null`) bloqueia preços futuros sobrepostos;
- revisão oficial fecha o preço anterior exatamente em `validFrom` da nova vigência;
- conflitos retornam `409 PRICING_OVERLAP`.

Document Engine:

- render concorrente do mesmo documento permite apenas um metadata winner;
- render concorrente perdedor recebe erro controlado `DOCUMENT_RENDER_FAILED`;
- falha de storage write não marca documento como renderizado;
- falha de banco após storage write tenta cleanup best-effort do binário recém-criado;
- download de metadata cujo binário não existe retorna erro controlado sem storage key.

Tested commands:

- `PATCH /assignments/:id/start`;
- `PATCH /assignments/:id/complete`;
- `PATCH /budgets/:id/approve`;
- `PATCH /budgets/:id/reject`;
- `DELETE /budgets/:id`;
- `POST /budgets/:id/render`;
- `GET /documents/:documentId/download`;
- `POST /products/:id/pricing`;
- `PATCH /pricing/:id`.

## Sprint 20 — AppSec contract hardening

No new business endpoint was added in this sprint.

Security-relevant contract clarifications:

- `POST /api/v1/financial/entries`
  - `status` is not accepted in the create payload.
  - `paidAt` is not accepted in the create payload.
  - New entries are always created as `PENDING`.
  - Payment must use `PATCH /api/v1/financial/entries/:id/pay`.
  - Attempts to send `status` or `paidAt` return `400 VALIDATION_ERROR` through the global
    `forbidNonWhitelisted` validation policy.
- `POST /api/v1/organization/assets`
  - MIME type and extension are not sufficient.
  - PDF must start with `%PDF-`.
  - PNG must contain the PNG magic signature.
  - JPEG must contain the JPEG magic signature.
  - SVG must be a real SVG payload and must not contain `<script`, inline event handlers,
    `javascript:` or `foreignObject`.
  - Invalid binary/signature returns `400 UPLOAD_INVALID_MIME_TYPE`.

Security test command:

```bash
TEST_DATABASE_URL='postgresql://user:pass@127.0.0.1:5432/orbit_security_test?schema=public' npm run test:security
```

The database name must end with `_test`.

## Sprint 20.5 — AppSec closure contract notes

No new business endpoint was added and no migration was created.

Asset Lifecycle public payload is now explicitly sanitized:

- `AssetLifecycleEvent.metadata` is not returned in public API responses;
- `performer.email` is not returned;
- `AssetLifecycleAttachment.storageKey`, `eventId` and `deletedAt` are not returned;
- attachments are handled only by authorized attachment endpoints.

Security closure suites validate Document Engine, Signatures, Maintenance Planning, PMOC,
Asset Lifecycle, Inventory, Procurement, audit metadata, rate limit/proxy trust and IDOR/BOLA
boundaries through the real NestJS HTTP application.

## Sprint 22 — production readiness contract notes

No business API contract was changed.

Operational endpoints verified:

- `GET /api/v1/health`
- `GET /api/v1/health/ready`
- `GET /api/v1/metrics`

`GET /api/v1/metrics` returns Prometheus text format (`text/plain; version=0.0.4`) and is the
official metrics route. It is not nested under `/health`.

Release verification scripts added:

```bash
npm run release:smoke:frontend
npm run release:workflows
```

Required environment for smoke/workflow scripts:

- `ORBIT_RELEASE_API_URL`
- `ORBIT_RELEASE_FRONTEND_URL` for frontend smoke
- `ORBIT_RELEASE_OWNER_EMAIL`
- `ORBIT_RELEASE_OWNER_PASSWORD`

The workflow runner uses only official API endpoints and fails on unexpected HTTP status, envelope
errors or missing identifiers.

## Sprint 22.5 — external closure contract notes

No API endpoint contract changed.

Operational decision:

- Orbit V1 remains single-company per installation.
- Production storage contract is local/block persistent storage via `STORAGE_PROVIDER=local`,
  `STORAGE_DRIVER=local` and absolute mounted `STORAGE_PATH`.
- Object storage is not an API/runtime contract certified for V1.

## Product Backlog Closure 02 — Document Engine contracts

Nenhum contrato HTTP novo foi criado.

Contratos oficiais reutilizados:

- `GET /api/v1/documents/operations/:operationId/:type/preview`
- `POST /api/v1/documents/operations/:operationId/:type/render`
- `GET /api/v1/documents/:documentId/preview`
- `POST /api/v1/documents/:documentId/render`
- `GET /api/v1/documents/:documentId/download`
- `GET /api/v1/documents/templates/:templateId/preview`

Mudança compatível:

- o payload `DocumentBlueprint.sections` passou a variar semanticamente por `DocumentTemplateType`
  para documentos operacionais, mantendo o mesmo formato de componentes já contratado.
- `download` continua retornando `contentBase64` apenas pelo endpoint autorizado de download;
  `storageKey` não é exposto.

## Document Semantics Closure — taxonomy update

Contrato de enum atualizado:

- `TECHNICAL_REPORT`: relatório técnico factual/operacional.
- `TECHNICAL_OPINION`: laudo técnico analítico.
- `REPORT`: tipo legado preservado para documentos históricos.

Endpoints não mudaram. Os mesmos contratos aceitam o novo tipo:

- `GET /api/v1/documents/operations/:operationId/TECHNICAL_OPINION/preview`
- `POST /api/v1/documents/operations/:operationId/TECHNICAL_OPINION/render`
- `GET /api/v1/documents/:documentId/preview`
- `GET /api/v1/documents/:documentId/download`

Model preview:

- `GET /api/v1/documents/templates/:templateId/preview`
- não renderiza;
- não cria `OperationDocument`;
- não fornece download oficial.

## Product Backlog Closure 03 — List PDF Exports and Signatures

### GET `/api/v1/operations/export`

Roles: `OWNER`, `MANAGER`, `OPERATOR`, `VIEWER`.

Query: `search`, `customerId`, `equipmentId`, `operatorId`, `type`, `status`.

Response 200:

- raw `application/pdf`;
- `Content-Disposition: attachment; filename="orbit-operacoes-YYYY-MM-DD.pdf"`;
- `X-Export-Record-Count`;
- `X-Export-Page-Count`.

### GET `/api/v1/equipments/export`

Roles: `OWNER`, `MANAGER`, `OPERATOR`, `VIEWER`.

Query: `search`, `customerId`, `addressId`, `type`, `status`.

Response: raw PDF, mesmo contrato de headers.

### GET `/api/v1/documents/export`

Roles: `OWNER`, `MANAGER`, `OPERATOR`, `VIEWER`.

Query: `search`, `customerId`, `equipmentId`, `operatorId`, `customer`, `equipment`, `operator`,
`type`, `status`, `from`, `to`.

Response: raw PDF, mesmo contrato de headers.

Export limits:

- limite V1: 500 registros;
- acima do limite retorna `400 BAD_REQUEST` com instrução para restringir filtros;
- exports são efêmeros e não criam `OperationDocument`;
- PDF deve iniciar com `%PDF-`;
- `storageKey`, path interno, blueprint bruto e metadados internos não são retornados.

### Signature listing semantics

`GET /api/v1/signatures` retorna apenas assinaturas com `deletedAt=null`.

- assinaturas ativas aparecem;
- assinaturas inativas aparecem;
- assinaturas soft-deleted não aparecem na listagem normal;
- resposta pública de assinatura retorna `hasImage`, não `imageStorageKey`.

`DELETE /api/v1/signatures/:id`:

- soft delete real;
- grava `active=false`;
- grava `deletedAt=now`;
- não remove arquivo do storage para preservar histórico.

## Product Backlog Closure 04 — Avatar e Notifications

`POST /api/v1/users/avatar` retorna metadados públicos sem `storageKey`.

```json
{
  "success": true,
  "data": {
    "id": "1f3f8e65-6d6e-40cc-9a6b-fd8e3d68e6c1",
    "mimeType": "image/png",
    "originalFileName": "avatar-1783700000000.png",
    "fileSize": 18432,
    "createdAt": "2026-07-10T17:00:00.000Z"
  }
}
```

### GET `/api/v1/notifications`

Query: `page`, `limit` máximo 50, `unread`, `type`.

### GET `/api/v1/notifications/unread-count`

```json
{ "success": true, "data": { "count": 3 } }
```

### PATCH `/api/v1/notifications/:id/read`

Marca como lida apenas notificação do usuário autenticado. Cross-user retorna
`NOTIFICATION_NOT_FOUND`.

### PATCH `/api/v1/notifications/read-all`

```json
{ "success": true, "data": { "updated": 3 } }
```

## DC02B — Corporate Header e dados documentais da Operation

`GET/PATCH /api/v1/organization` inclui/aceita de forma aditiva:

```json
{
  "stateRegistration": "0321418-40",
  "phoneNumbers": ["+55 81 3030-0000", "+55 81 99999-0000"]
}
```

`phoneNumbers` aceita até cinco strings de 30 caracteres. Somente OWNER altera; MANAGER lê.

`POST /api/v1/operations` e `PATCH /api/v1/operations/:id` aceitam opcionalmente:

```json
{
  "referenceMonth": 6,
  "referenceYear": 2026,
  "maintenanceType": "SEMIANNUAL",
  "maintenanceChecklist": [
    {
      "maintenanceType": "WEEKLY",
      "description": "Inspecionar as condições operacionais",
      "executed": true,
      "observations": "Condição confirmada"
    }
  ],
  "inspectedEquipments": [
    {
      "equipmentId": "7de712a5-692a-481f-b080-189e518628c0",
      "sector": "Recepção"
    }
  ]
}
```

Enum: `WEEKLY`, `MONTHLY`, `QUARTERLY`, `SEMIANNUAL`, `ANNUAL`, `CORRECTIVE`.

Regras: mês 1–12 e ano 2000–2200 devem existir juntos; checklist tem máximo 400 itens;
`inspectedEquipments` tem máximo 100 UUIDs únicos, ativos e do mesmo cliente. O backend cria snapshots
de marca/modelo/capacidade/tag/série. Respostas detalhadas retornam `maintenanceChecklistItems` e
`inspectedEquipments` ordenados. Erros: `OPERATION_EQUIPMENT_INVALID` e
`OPERATION_REFERENCE_PERIOD_INVALID`.

Endpoints do Document Engine não mudaram; o Preview inclui as novas seções quando os dados existem.

# Maintenance checklist template catalog

Base path: `/api/v1/maintenance-checklist-templates`.

- `GET /` (`OWNER`, `MANAGER`, `VIEWER`): paginated list. Query: `page`, `limit` (max 100), `search`, `maintenanceType`, `active`.
- `GET /:id` (`OWNER`, `MANAGER`, `VIEWER`): returns one organization-scoped item.
- `POST /` (`OWNER`, `MANAGER`): `{ "maintenanceType": "SEMIANNUAL", "description": "...", "active": true }`.
- `PATCH /:id` (`OWNER`, `MANAGER`): accepts a partial create payload.
- `DELETE /:id` (`OWNER`, `MANAGER`): soft-deactivates and returns `{ "deactivated": true }`.

Item response:

```json
{
  "id": "uuid",
  "organizationId": "uuid",
  "maintenanceType": "SEMIANNUAL",
  "description": "Inspeção das conexões e componentes elétricos",
  "active": true,
  "createdAt": "2026-07-14T14:30:00.000Z",
  "updatedAt": "2026-07-14T14:30:00.000Z"
}
```

Errors follow the global envelope. Relevant codes: `MAINTENANCE_CHECKLIST_TEMPLATE_NOT_FOUND` (404), `MAINTENANCE_CHECKLIST_TEMPLATE_CONFLICT` (409), validation errors (400), unauthorized (401), forbidden (403), and rate limit (429).

## Technical Catalogs

Base path: `/api/v1/technical-catalogs`. Todos os retornos seguem o envelope global.

Tipos oficiais: `CHECKLIST`, `OBJECTIVE`, `SITE_CONDITION`, `CONCLUSION`, `RECOMMENDATION`.

### GET `/types`

Retorna descritores ordenados fornecidos pelo backend, evitando labels de tipos duplicadas no
frontend.

```json
{
  "success": true,
  "data": [{ "value": "OBJECTIVE", "label": "Objetivos" }]
}
```

Roles de leitura: `OWNER`, `MANAGER`, `OPERATOR`, `VIEWER`.

### GET `/`

Query: `page` (default 1), `limit` (default 20, máximo 100), `search`, `type`,
`maintenanceType`, `active`, `sortBy=sortOrder|title|updatedAt`, `order=asc|desc`.

```json
{
  "success": true,
  "data": {
    "items": [
      {
        "id": "33333333-3333-4333-8333-333333333333",
        "organizationId": "11111111-1111-4111-8111-111111111111",
        "type": "SITE_CONDITION",
        "title": "Compressor não parte",
        "description": null,
        "maintenanceType": null,
        "sortOrder": 5,
        "active": true,
        "createdAt": "2026-07-15T14:00:00.000Z",
        "updatedAt": "2026-07-15T14:00:00.000Z"
      }
    ],
    "pagination": { "page": 1, "limit": 20, "total": 21, "totalPages": 2 }
  }
}
```

### GET `/:id`

UUID v4 obrigatório. Retorna item não excluído pertencente à organização da instalação.

### POST `/`

Roles: `OWNER`, `MANAGER`.

```json
{
  "type": "OBJECTIVE",
  "title": "Avaliação de rendimento térmico",
  "description": "Aplicável após estabilização operacional",
  "sortOrder": 6,
  "active": true
}
```

Para `CHECKLIST`, `maintenanceType` é obrigatório. Para os demais tipos, esse campo é proibido.

### PATCH `/:id`

Roles: `OWNER`, `MANAGER`. Aceita `title`, `description`, `maintenanceType` quando checklist,
`sortOrder` e `active`.

### PATCH `/reorder`

Roles: `OWNER`, `MANAGER`.

```json
{
  "type": "CONCLUSION",
  "items": [
    { "id": "33333333-3333-4333-8333-333333333333", "sortOrder": 0 },
    { "id": "44444444-4444-4444-8444-444444444444", "sortOrder": 1 }
  ]
}
```

Todos os IDs devem pertencer à mesma organização e ao tipo informado. Retorno:
`{ "success": true, "data": { "reordered": 2 } }`.

### DELETE `/:id`

Roles: `OWNER`, `MANAGER`. Exclusão lógica (`active=false`, `deletedAt` interno). Retorna
`{ "success": true, "data": { "deleted": true } }`.

Erros específicos: `TECHNICAL_CATALOG_NOT_FOUND` (404), `TECHNICAL_CATALOG_CONFLICT` (409),
`TECHNICAL_CATALOG_INVALID_TYPE` (400), `TECHNICAL_CATALOG_INVALID_ORDER` (400), além de 401,
403, validação global 400 e rate limit 429.

### Operation — extensão aditiva do Laudo Técnico

`POST /operations` e `PATCH /operations/:id` aceitam:

```json
{
  "technicalOpinionObjective": "Inspeção Preventiva",
  "technicalOpinionConditions": "Ruído excessivo\nVibração anormal",
  "technicalOpinionRecommendations": "Monitoramento periódico",
  "technicalOpinionConclusion": "Necessita nova inspeção"
}
```

Cada campo armazena texto/snapshot, nunca IDs do catálogo. Máximo: 20.000 caracteres por campo.

## Technical Catalog — classificação contextual (Closure 08.1)

`GET /technical-catalogs/taxonomy` (todas as roles autenticadas) retorna `areas[]` e
`workflows[]` com `value` e `label` oficiais.

`GET /technical-catalogs` aceita, adicionalmente:

- `areas`: enums separados por vírgula; compatibilidade por interseção;
- `workflow`: um workflow oficial;
- `includeGeneral`: inclui itens `GENERAL` e mantém os específicos primeiro;
- `search`: pesquisa título, descrição e tag normalizada.

Exemplo:
`?type=SITE_CONDITION&areas=HVAC,REFRIGERATION&workflow=TECHNICAL_OPINION&includeGeneral=true&active=true&page=1&limit=100`.

Itens retornados incluem `tags: string[]`, `areas: TechnicalCatalogArea[]` e
`workflows: TechnicalCatalogWorkflow[]`. POST/PATCH aceitam as mesmas coleções. Limites: 20 tags
de 40 caracteres, 1–7 áreas e 1–6 workflows, sem duplicidade. Clientes antigos que omitirem
áreas/workflows em criação recebem `GENERAL`.

## DC-04 — payload operacional do PMOC

`POST /api/v1/operations` e `PATCH /api/v1/operations/:id` aceitam `maintenanceChecklist[]` com
`equipmentId?`, `maintenanceType`, `description`, `executed`, `result` (`YES`, `NO` ou
`NOT_APPLICABLE`) e `observations?`. Para a coleta do cliente aceitam `customerSignerName`,
`customerSignerRole`, `signatureData` (PNG/JPEG data URL) e `signedAt`.

O equipamento deve estar ativo e pertencer ao cliente da Operation. A resposta informa
`signatureCaptured`, mas nunca retorna `signatureData`. Preview, Render e Download continuam nos
contratos oficiais do Document Engine.

## Laudo Técnico — Objetivo e Conclusão estruturados

`POST /api/v1/operations` e `PATCH /api/v1/operations/:id` aceitam, de forma aditiva:

```json
{
  "technicalOpinionObjective": "Esclarecimento principal do responsável técnico.",
  "technicalOpinionObjectiveItems": ["Item predefinido complementar"],
  "technicalOpinionConclusion": "Conclusão fundamentada do responsável técnico.",
  "technicalOpinionConclusionItems": ["Resultado predefinido complementar"]
}
```

Cada coleção aceita até 50 strings de 500 caracteres. A resposta de Operation retorna as duas
coleções. Os campos textuais existentes permanecem compatíveis e continuam sendo o conteúdo
principal do documento.

## PMOC — criação independente e numeração própria

`POST /api/v1/pmoc` cria o plano antes de qualquer Ordem de Serviço:

```json
{
  "customerId": "uuid-do-cliente",
  "equipmentId": "uuid-do-equipamento-principal",
  "equipmentIds": ["uuid-do-equipamento"],
  "responsibleTechnician": "Responsável técnico",
  "startDate": "2026-07-15",
  "endDate": "2027-07-15",
  "recurrenceRule": { "frequency": "MONTHLY", "interval": 1 }
}
```

Response `201`: `PmocPlan` completo, incluindo `number` e `maintenancePlan.name` no padrão
`PMOC · {cliente} · PMOC-{number com seis dígitos}`.

`sourceOperationId` não pertence ao contrato. A futura OS é uma Operation oficial vinculada por
`MaintenanceExecution.operationId`. Atualização e remoção lógica continuam em `PATCH /pmoc/:id` e
`DELETE /pmoc/:id`.

## PMOC UX-01 — cobertura e tipos de serviço

- `POST /api/v1/pmoc` e `PATCH /api/v1/pmoc/:id` aceitam `equipmentIds: UUID[]` (1–50, únicos) e
  `serviceTypes: OperationType[]` (até 4, únicos).
- `POST /api/v1/operations` e `PATCH /api/v1/operations/:id` aceitam `serviceTypes`.
- Valores oficiais: `PREVENTIVA`, `CORRETIVA`, `INSTALACAO`, `PROJETO`.
- O primeiro tipo é o principal; omissão mantém o contrato singular anterior.

```json
{
  "customerId": "uuid",
  "equipmentId": "uuid-principal",
  "equipmentIds": ["uuid-principal", "uuid-secundario"],
  "defaultOperationType": "PREVENTIVA",
  "serviceTypes": ["PREVENTIVA", "CORRETIVA"],
  "signatureOverrideId": "uuid-assinatura-opcional"
}
```

O prefill e a OS gerada retornam `serviceTypes[]` e `inspectedEquipments[]` completos. Equipamento
inativo, removido ou de outro cliente retorna `400 PMOC_INVALID_RELATIONSHIP`.

O override não altera o Template. Em Preview/Render PMOC, substitui as assinaturas institucionais
somente em `FIXED`/`HYBRID`; não é renderizado em `NONE`/`COLLECTED`.

## Field Report Handoff 01

Todos os contratos abaixo usam `/api/v1`, envelope padrão e UUID v4. Operator só acessa documentos
da Operation atribuída a ele; OWNER/MANAGER administram a revisão.

### `GET /documents/handoffs`

OWNER/MANAGER. Query paginada: `page`, `limit`, `search`, `status`, `type`, `origin`, `customerId`,
`operatorId`, `from`, `to`, `missingCustomerSignature`, `missingTechnicalSignature`,
`missingEvidence`. Retorna `items[]` com documento, Operation, cliente, operador, quantidades,
assinaturas sanitizadas, pendências, origem, estado editorial e revisão.

### `POST /documents/handoffs`

```json
{ "operationId": "uuid", "type": "WORK_ORDER" }
```

Tipos Operator: `WORK_ORDER`, `TECHNICAL_REPORT`, `TECHNICAL_OPINION`, `BUDGET`, `PMOC`. Cria ou
atualiza idempotentemente o documento `(operationId,type)` em DRAFT. `RECEIPT` pelo Operator retorna
`403 DOCUMENT_HANDOFF_NOT_ALLOWED`.

### `GET /documents/:documentId/handoff`

Retorna detalhes da coleta/revisão. Nunca retorna `storageKey`, path, bucket ou Base64.

### `PATCH /documents/:documentId/handoff/customer-signature`

```json
{
  "signerName": "Responsável local",
  "signerRole": "Contratante",
  "signatureData": "data:image/png;base64,...",
  "collectedAt": "2026-07-17T15:00:00.000Z",
  "timezone": "America/Recife"
}
```

Aceita PNG/JPEG binariamente válidos, até 2 MiB. Persiste imagem no Storage e snapshot com hash,
ator, data, timezone e origem. `400 VALIDATION_ERROR` para conteúdo inválido.

### `GET /documents/:documentId/handoff/customer-signature`

OWNER/MANAGER ou Operator atribuído. Resposta binária `image/png|image/jpeg`, `Content-Disposition:
inline` e `Cache-Control: private, no-store`. Não expõe identificadores internos do Storage.

### `POST /documents/:documentId/handoff/submit`

Operator atribuído ou gestão. Valida matriz de assinatura e, para PMOC, mínimo de quatro evidências.
Retorna DRAFT submetido. Erros: `409 DOCUMENT_CUSTOMER_SIGNATURE_REQUIRED`,
`409 PMOC_EVIDENCE_REQUIRED`.

### Revisão

- `POST /documents/:id/handoff/review`: OWNER/MANAGER; muda para PENDING.
- `PATCH /documents/:id/handoff/technical-signature` com `{ "signatureId": "uuid" }`: exige
  assinatura ativa com imagem; a escolha vale somente para o documento.
- `POST /documents/:id/handoff/finalize` com `{ "confirm": true }`: valida pendências, copia a
  imagem técnica para snapshot imutável e muda para READY.
- `GET /documents/:id/handoff/history`: histórico crescente de `revision`, `action`, `origin`, ator,
  campos alterados e timestamp.

Erros comuns: `403 FORBIDDEN`, `404 DOCUMENT_NOT_FOUND`, `409 SIGNATURE_IMAGE_REQUIRED`,
`409 DOCUMENT_REVIEW_INCOMPLETE` com `details.issues[]`.

### Preview, render e repositório

`GET /documents/:id/preview` permanece compatível. `POST /documents/:id/render` é exclusivo de
OWNER/MANAGER e, para handoff submetido, requer READY. `GET /documents/:id/download` permanece
autorizado e binário. `GET /documents` aceita `editorialStatus` e retorna também `handoffOrigin`,
`submittedAt`, `finalizedAt` e `revision`. Alterações relevantes após emissão marcam STALE.

### Assinaturas técnicas

Create/PATCH de `/signatures` aceitam adicionalmente `profession`, `registrationNumber`,
`isDefault` e `position`. Existe no máximo uma assinatura ativa padrão por organização.

## PMOC FIX-01 — contrato documental existente

Não há endpoint novo. O fluxo oficial permanece:

- `GET /documents/operations/:operationId/PMOC/preview` ou `GET /documents/:id/preview`;
- `POST /documents/operations/:operationId/PMOC/render` ou `POST /documents/:id/render`;
- `GET /documents/:id/download` (binário `application/pdf`);
- `GET /documents?type=PMOC` para o repositório oficial.

Os objetos `operation.documents[]` devolvidos em `GET /pmoc/:id` e
`GET /pmoc/:id/execution-requests` incluem `id`, `number`, `status`, `renderedAt`, `fileSize`,
`revision` e `renderMetadata`. Não incluem `storageKey`, path, Base64 ou URL pública.

`GET /documents/:id/download` retorna `409 DOCUMENT_STALE` quando uma fonte documental mudou. O
cliente deve chamar `POST /documents/:id/render` e repetir o download; números e histórico são
preservados e `revision` é incrementada.
# PMOC FIX-02A — metadados da assinatura coletada

Os contratos existentes de handoff permanecem retrocompatíveis. `GET /api/v1/documents/:documentId/handoff` e `PATCH /api/v1/documents/:documentId/handoff/customer-signature` agora incluem o coletor no objeto de assinatura:

```json
{
  "customerSignature": {
    "name": "Responsável da unidade",
    "role": "Cliente",
    "collectedAt": "2026-07-17T15:42:00.000Z",
    "timezone": "America/Recife",
    "origin": "OPERATOR",
    "available": true,
    "collectedBy": {
      "id": "uuid",
      "name": "João Silva",
      "role": "OPERATOR"
    }
  }
}
```

Uma nova chamada de coleta substitui o snapshot corrente, incrementa a revisão e registra o novo coletor. Documentos binários históricos já emitidos não são reescritos.

## PMOC FIX-02B — evidências da Operation

`GET /api/v1/operations/:id` inclui `createdBy: { id, name, role } | null` em cada foto, além de id, legenda, MIME, tamanho e data. Não inclui conteúdo ou `storageKey`.

- `PATCH /api/v1/operations/photos/:photoId` — OWNER/MANAGER; body `{ "caption": "string" }` (máximo 255); retorna a Operation atualizada.
- `DELETE /api/v1/operations/photos/:photoId` — OWNER/MANAGER; remove a evidência corrente, preserva auditoria e retorna a Operation atualizada.
- `GET /api/v1/operations/photos/:photoId` permanece o acesso autenticado ao conteúdo encapsulado.
- Upload continua em `PATCH /api/v1/operations/:id`, `photos[]`, PNG/JPEG, 5 MiB por arquivo e máximo acumulado 16.

Erros: `400 OPERATION_PHOTO_INVALID`, `403 FORBIDDEN`, `404 OPERATION_PHOTO_NOT_FOUND`.

## Workflow de atendimento iniciado no Operator

### `POST /api/v1/operations`

Campo aditivo:

```json
{
  "documentType": "WORK_ORDER | TECHNICAL_REPORT | TECHNICAL_OPINION | BUDGET | PMOC"
}
```

`documentType` é opcional e assume `WORK_ORDER`. A resposta inclui `requestedDocumentType` e `assignment { id, assignedBy, assignedTo, status }`. Quando diferente de `WORK_ORDER`, o backend cria também o `OperationDocument` solicitado; a OS automática é preservada por compatibilidade.

### `POST /api/v1/documents/:documentId/handoff/submit`

A resposta mantém `editorialStatus` e adiciona:

```json
{
  "workflowStatus": "DRAFT | REVIEW | APPROVED | STALE",
  "assignmentOrigin": "OPERATOR | MANAGEMENT"
}
```

- Assignment próprio (`assignedBy == assignedTo`): submissão fica `editorialStatus: DRAFT`, `workflowStatus: DRAFT`.
- Assignment delegado (`assignedBy != assignedTo`): submissão fica `editorialStatus: PENDING`, `workflowStatus: REVIEW`.
- Finalização por OWNER/MANAGER: `READY` / `APPROVED`.

### PMOC assumido pelo Operator

`GET /api/v1/pmoc/execution-requests/:id/prefill` e `POST /api/v1/pmoc/execution-requests/:id/generate-work-order` aceitam OPERATOR somente quando a solicitação não possui operador planejado ou está planejada para o próprio ator. Solicitação reservada a terceiro retorna `403 FORBIDDEN`.
## DC-06 — Orçamento certificado

### POST /api/v1/budgets

OWNER/MANAGER. Criação manual omite operationId; criação pela OS informa o UUID de uma Operation concluída. A API rejeita outras situações com `409 BUDGET_OPERATION_NOT_COMPLETED`. Campos documentais:

```json
{
  "operationId": "uuid opcional",
  "customerId": "uuid",
  "customerAddressId": "uuid opcional",
  "equipmentId": "uuid opcional",
  "title": "Orçamento de manutenção",
  "description": "Escopo editável",
  "issuedAt": "2026-07-18T12:00:00.000Z",
  "introduction": "Atendendo à honrosa solicitação...",
  "validityDays": 30,
  "amountInWords": "um mil duzentos e setenta e cinco reais",
  "paymentMethods": ["PIX", "CREDIT_CARD"],
  "commercialNotes": "Pagamento após aprovação.",
  "status": "DRAFT",
  "items": [
    { "type": "SERVICE", "description": "Higienização", "quantity": 1, "unit": "SERV", "unitPrice": 850, "sortOrder": 0 },
    { "type": "MATERIAL", "description": "Filtro", "quantity": 5, "unit": "UN", "unitPrice": 85, "sortOrder": 1 }
  ]
}
```

productId é opcional. A resposta inclui serviceSubtotal, materialSubtotal, subtotal, total, amountInWords, paymentMethods e document. Totais são calculados pelo backend.

### PATCH /api/v1/budgets/:id

Atualização parcial enquanto editável. Alterar orçamento renderizado marca o documento STALE.

### GET /api/v1/budgets/:id/preview

Retorna o DocumentBlueprint oficial sem gerar PDF. Erros: 403 FORBIDDEN, 404 BUDGET_NOT_FOUND e 409 BUDGET_INVALID_STATUS.

### Emissão e assinaturas

- POST /api/v1/budgets/:id/render — gera/regera PDF e retorna documentId, preview, download e status.
- GET /api/v1/budgets/:id/download — binário autenticado application/pdf.
- PATCH /api/v1/documents/:documentId/handoff/customer-signature — coleta/substitui assinatura do cliente para Budget.
- PATCH /api/v1/documents/:documentId/handoff/technical-signature — seleciona a assinatura técnica.
# Sales API — Customer Workspace

Todas as rotas usam `/api/v1`, JWT e o envelope padrão.

## `GET /sales`

Filtros: `page`, `limit`, `customerId`, `status=DRAFT|COMPLETED|CANCELED`, `search`, `from`, `to`. Retorna paginação oficial e itens com cliente, endereço, criador, snapshots dos produtos e recibos relacionados.

## `POST /sales` — OWNER/MANAGER

```json
{
  "customerId": "uuid",
  "customerAddressId": "uuid",
  "soldAt": "2026-07-22T12:00:00.000Z",
  "warrantyDays": 90,
  "warrantyStartsAt": "2026-07-22",
  "discount": 0,
  "notes": "Venda e instalação no local",
  "items": [{ "productId": "uuid", "quantity": 1 }]
}
```

O cliente, endereço, produto ativo e preço vigente são validados. Descrição, unidade, custo e preço são snapshots do backend. Retorna `201` com a venda completa. Erros: `404 CUSTOMER_NOT_FOUND|PRODUCT_NOT_FOUND|PRICING_NOT_FOUND`, `409 SALE_INVALID_RELATIONSHIP`, `400 BAD_REQUEST`.

## `GET /sales/:id`, `PATCH /sales/:id`, `DELETE /sales/:id`

- `GET`: OWNER/MANAGER/VIEWER.
- `PATCH`: somente venda `DRAFT`; aceita os campos de criação, exceto `customerId`.
- `DELETE`: cancelamento lógico; histórico e número permanecem.

## `PATCH /sales/:id/complete`

Conclui atomicamente uma venda `DRAFT`. Vendas concluídas tornam-se comercialmente imutáveis.

## `GET /sales/:id/receipt-prefill`

Somente vendas `COMPLETED`. Retorna `saleId`, número sugerido, data, cliente, endereço, valor, descrição dos produtos e cobertura da garantia. O Wizard permanece livre para edição antes de criar a `Operation` do tipo `RECEIPT` com `sourceSaleId`.
# `POST /api/v1/users/complete-first-access`

Conclui o primeiro acesso autenticado em uma única operação. Permitido enquanto `mustChangePassword=true` e liberado pelo guard exclusivamente para este fluxo.

`multipart/form-data`:

- `currentPassword` — senha temporária;
- `newPassword` — 12 a 128 caracteres;
- `signatureTitle` — cargo exibido no documento;
- `profession`, `professionalCouncil`, `registrationNumber`, `department` — opcionais;
- `file` — PNG ou JPEG, máximo 2 MiB, obrigatório.

Resposta `201`:

```json
{
  "completed": true,
  "signatureId": "uuid",
  "reauthenticationRequired": true
}
```

O backend revoga sessões, desativa `mustChangePassword` e persiste a assinatura na entidade oficial `Signature`. Erros possíveis: `PASSWORD_CURRENT_INVALID`, `PASSWORD_REUSE_NOT_ALLOWED`, `SIGNATURE_IMAGE_REQUIRED`, `UPLOAD_INVALID_MIME_TYPE`, `UPLOAD_FILE_TOO_LARGE`, `VALIDATION_ERROR` e `BAD_REQUEST` quando o primeiro acesso já foi concluído.
# Product commercial classification — 2026-07-22

## Product fields

Todos os payloads de produto incluem:

```json
{
  "isPurchasable": true,
  "isSellable": true
}
```

Pelo menos um campo deve ser `true`. `POST /api/v1/products` e `PATCH /api/v1/products/:id` retornam `400 PRODUCT_COMMERCIAL_CLASSIFICATION_REQUIRED` quando a classificação resultante desabilita as duas finalidades.

## GET /api/v1/products

Filtros opcionais adicionais:

- `purchasable=true|false`
- `sellable=true|false`

Os filtros são cumulativos com busca, status e paginação. `GET /api/v1/products?sellable=true` é o contrato oficial dos seletores de vendas; `purchasable=true`, dos fluxos de compras e materiais.

## Validações entre domínios

- criar venda com produto não vendável: `409 PRODUCT_NOT_SELLABLE`;
- adicionar produto não comprável a pedido de compra: `409 PRODUCT_NOT_PURCHASABLE`.
# Product conflict localization — 2026-07-22

`POST /api/v1/products` e `PATCH /api/v1/products/:id` mantêm o código `409 PRODUCT_CONFLICT`. A mensagem pública para colisão de SKU ou código interno é `Já existe um produto com este SKU ou código interno`.

O preço inicial continua sendo persistido separadamente por `POST /api/v1/products/:id/pricing`; `Product` não recebe campos monetários.
# Sales product availability — 2026-07-22

O seletor oficial de produtos de uma venda usa `GET /api/v1/pricing?active=true&at=:soldAt`. Cada registro inclui os dados técnicos de `product`, inclusive `isActive` e `isSellable`, e o `salePrice` vigente.

A criação de venda continua revalidando no backend:

- produto inexistente/inativo: `404 PRODUCT_NOT_FOUND`;
- produto não habilitado para venda: `409 PRODUCT_NOT_SELLABLE`;
- preço não vigente na data: `404 PRICING_NOT_FOUND`.

Saldo físico não é alterado por `PATCH /inventory/:id`; somente `POST /inventory/movements` altera quantidade.

# Operator — assinatura obrigatória em OS/RVT — 2026-07-22

## POST /api/v1/operations

Quando o ator é `OPERATOR` e `documentType` é `WORK_ORDER` ou `TECHNICAL_REPORT`, o payload deve incluir os campos editoriais separados e a coleta:

```json
{
  "reportedIssue": "Defeito ou solicitação",
  "serviceDescription": "Serviços previstos ou executados",
  "observations": "Observações",
  "signatureData": "data:image/png;base64,...",
  "customerSignerName": "Maria da Silva",
  "customerSignerRole": "Responsável pelo local",
  "signedAt": "2026-07-22T15:42:00.000Z"
}
```

`signatureData` e `customerSignerName` são obrigatórios nesse contexto. `signedAt` é aceito do instante de coleta e, quando omitido, definido pelo backend. Falha: `400 DOCUMENT_CUSTOMER_SIGNATURE_REQUIRED`.

## PATCH /api/v1/assignments/:id/complete

Para OS/RVT, a conclusão exige que a Operation possua `signatureData`, `customerSignerName` e `signedAt`. Falha: `409 DOCUMENT_CUSTOMER_SIGNATURE_REQUIRED`. A regra vale independentemente da interface.

Preview e PDF resolvem a mesma assinatura pelo `DocumentContext`; o PDF apresenta `Assinado em: DD/MM/AAAA, HH:mm`.

## Semântica documental do status

Os enums permanecem inalterados na API (`DRAFT`, `PENDING`, `IN_PROGRESS`, `REVIEW`, `COMPLETED`, `CANCELED`). No conteúdo do Blueprint/Preview/PDF, o Builder os apresenta respectivamente como `Rascunho`, `Pendente`, `Em andamento`, `Em revisão`, `Concluída` e `Cancelada`.

# Assinatura própria do Operator

## GET /api/v1/signatures/me

Role: `OPERATOR`. Retorna a `Signature` vinculada ao usuário autenticado ou `null` quando ainda não configurada. Nunca lista assinaturas de terceiros.

## POST /api/v1/signatures/me

Role: `OPERATOR`. Multipart `form-data`:

- `title` — obrigatório;
- `profession`, `professionalCouncil`, `registrationNumber`, `department` — opcionais;
- `file` — PNG/JPEG até 2 MiB; obrigatório na primeira configuração e opcional em atualizações sem troca da imagem.

Cria ou atualiza a assinatura oficial com `userId = actor.id`, reativa registro próprio removido e registra auditoria. Retorna `Signature` sem `imageStorageKey`.

## GET /api/v1/signatures/me/download

Role: `OPERATOR`. Retorna somente a imagem da assinatura vinculada ao próprio ator. Erros: `404 SIGNATURE_NOT_FOUND` e `409 SIGNATURE_IMAGE_REQUIRED`.

## PATCH /api/v1/documents/:documentId/handoff/technical-signature

OWNER/MANAGER mantêm o comportamento existente. OPERATOR pode chamar somente quando:

- documento é `WORK_ORDER` ou `TECHNICAL_REPORT`;
- possui acesso à Operation;
- é o operador responsável;
- `signatureId` pertence ao próprio usuário, está ativo e possui imagem.

Tentativa de selecionar assinatura de outro usuário retorna `403 FORBIDDEN`. A seleção deixa documento renderizado como `STALE` e a finalização preserva snapshot imutável.
## Semântica de `checklist` por origem da Ordem de Serviço

- Atendimento autônomo iniciado pelo Operator: envia somente atividades selecionadas e já realizadas, com `done: true`.
- Atendimento criado/atribuído pela Platform: pode enviar atividades planejadas com `done: false`, que serão marcadas pelo técnico durante a execução.
- O payload permanece `{ "label": "string", "done": boolean, "note"?: "string" }`; IDs do Catálogo Técnico não fazem parte deste contrato.
## Infraestrutura de imagem — 2026-07-22

O ajuste de construção da imagem não altera rotas, payloads, códigos HTTP ou contratos da API V1.
## Catálogos Técnicos — filtros de workflow do checklist

`GET /api/v1/technical-catalogs`

Novo query param aditivo:

- `workflowsAny=WORK_ORDER,PMOC`: retorna itens aplicáveis a qualquer workflow informado.
- `includeGeneral=true`: acrescenta itens `GENERAL` à seleção.
- `workflow=TECHNICAL_REPORT&includeGeneral=false`: contrato oficial do checklist exclusivo do RVT.

Os registros do RVT continuam usando o payload existente:

```json
{
  "type": "CHECKLIST",
  "title": "Limpeza de filtro de ar",
  "areas": ["GENERAL", "HVAC"],
  "workflows": ["TECHNICAL_REPORT"],
  "maintenanceType": "WEEKLY",
  "active": true
}
```

Criação, edição, reordenação, ativação/desativação e exclusão utilizam os contratos existentes.

## Execução PMOC por equipamento

`POST /api/v1/pmoc/:id/execution-requests`

```json
{
  "equipmentId": "uuid",
  "scheduledFor": "2026-07-27T18:30:00.000Z",
  "notes": "Execução iniciada para o equipamento selecionado."
}
```

- `equipmentId` deve pertencer à cobertura. Se omitido, usa o equipamento primário legado.
- A resposta inclui `equipmentId` e `equipment`.
- A unicidade é PMOC + equipamento + instante.
- Prefill e geração retornam/persistem apenas esse equipamento em `inspectedEquipments`.
- `operation.photos` aceita no máximo seis evidências; violações retornam
  `400 VALIDATION_ERROR`.
# Equipamentos coletados durante a execução da OS

## `POST /api/v1/operations/:id/equipments`

Permissão: somente `OPERATOR` com `canReports`, Assignment próprio ativo e Operation
`IN_PROGRESS` ainda sem equipamentos.

Request:

```json
{
  "existingEquipmentIds": ["uuid"],
  "newEquipments": [
    {
      "equipmentTypeCatalogId": "uuid",
      "sector": "Sala técnica",
      "manufacturer": "Carrier",
      "model": "42X",
      "capacity": "18.000 BTU/h",
      "serialNumber": "ABC123",
      "voltage": "220 V"
    }
  ]
}
```

Ao menos uma das listas precisa possuir itens; o total combinado é limitado a 20. Novos itens
exigem tipo técnico ativo e ao menos marca ou modelo. Cliente e endereço nunca são aceitos do
frontend: são derivados da Operation.

Response `201`: `OperationDetail` atualizado, incluindo `equipment` e `inspectedEquipments`.

Erros: `400 OPERATION_EQUIPMENT_INVALID`, `400 TECHNICAL_CATALOG_NOT_FOUND`,
`403 FORBIDDEN`, `404 OPERATION_NOT_FOUND`, `409 OPERATION_INVALID_TRANSITION`.

# Cadastro avulso de cliente com múltiplos equipamentos

## `POST /api/v1/customers/walk-in`

Permissão: OWNER, MANAGER ou OPERATOR com `canReports`.

```json
{
  "type": "COMPANY",
  "name": "Clínica Recife",
  "address": {
    "street": "Rua da Aurora",
    "number": "100",
    "district": "Boa Vista",
    "city": "Recife",
    "state": "PE"
  },
  "contact": { "name": "Ana Lima", "phone": "81999999999" },
  "equipments": [
    {
      "equipmentTypeCatalogId": "uuid",
      "manufacturer": "Midea",
      "model": "Xtreme Save",
      "capacity": "12.000 BTU/h",
      "sector": "Recepção",
      "serialNumber": "ABC123",
      "voltage": "220 V"
    }
  ]
}
```

`equipments` exige de 1 a 20 itens e tipo `EQUIPMENT_TYPE` ativo. Response `201`:

```json
{
  "customerId": "uuid",
  "addressId": "uuid",
  "addressLabel": "Rua da Aurora, 100, Boa Vista, Recife",
  "equipmentId": "uuid-do-primeiro-item",
  "equipmentName": "Midea Xtreme Save",
  "equipments": [
    { "id": "uuid", "name": "Midea Xtreme Save", "sector": "Recepção" }
  ]
}
```

O campo legado singular `equipment` permanece aceito. Erros: `400 VALIDATION_ERROR`,
`400 TECHNICAL_CATALOG_NOT_FOUND`, `403 FORBIDDEN` e `409 CUSTOMER_CONFLICT`.

## RVT Planning (2026-08-03)

- `GET /api/v1/rvt-plans`: paginação e filtros `search`, `customerId`, `equipmentId`, `status`.
- `POST /api/v1/rvt-plans` (`OWNER/MANAGER`): `{ customerId, addressId, name, maintenanceType: "WEEKLY"|"SEMIANNUAL", startDate, endDate, responsibleTechnicianId, defaultOperatorId?, equipmentIds[], checklistCatalogIds[], observations? }`. Cria somente planejamento (1–520 ocorrências).
- `GET|PATCH|DELETE /api/v1/rvt-plans/:id`: detalhe, alteração e cancelamento lógico; cobertura só é recalculada antes de existir Operation.
- `GET /api/v1/rvt-plans/:id/executions`: query `page`, `limit`, `status`, `from`, `to`; retorna ocorrências com operador, Operation e documentos.
- `GET /api/v1/rvt-executions/:id/prefill`: cliente, endereço, equipamentos, responsáveis, periodicidade, checklist, observações e data prevista.
- `POST /api/v1/rvt-executions/:id/prepare`: `{ operatorId? }`; cria idempotentemente Operation, Assignment e vínculos, retornando `OperationDetail`.
- `POST /api/v1/rvt-plans/ad-hoc` (`OPERATOR`): `{ operationId }`; registra configuração/primeira ocorrência de RVT avulso já concluído.
- Estados do plano: `ACTIVE|PAUSED|COMPLETED|CANCELED`; ocorrência: `PENDING|ASSIGNED|IN_PROGRESS|COMPLETED|CANCELED`.

### Conclusão da Operation de uma execução RVT

`PATCH /api/v1/operations/:id` continua aceitando em `maintenanceChecklist[]` somente
`equipmentId?`, `pmocUnit?`, `maintenanceType`, `description`, `executed`, `result?` e
`observations?`. Propriedades de projeção como `id`, `position` e `equipment` são somente leitura e
continuam rejeitadas por `forbidNonWhitelisted`.

Para ocorrências não finais, a resposta de `POST /rvt-executions/:id/prepare` contém
`assignment: { id, assignedBy, assignedTo, status }`. Se uma Operation histórica estiver sem
atribuição, o endpoint cria a Assignment primária antes de responder. OWNER/MANAGER podem informar
qualquer usuário operacional ativo em `operatorId`; OPERATOR permanece restrito a si próprio.

### Auxiliares da execução

`PATCH /api/v1/operations/:id`

```json
{ "auxiliaryOperatorIds": ["uuid-do-auxiliar"] }
```

Somente OWNER/MANAGER. Máximo de dez usuários ativos. `OperationDetail` retorna `assignment`
primária e `auxiliaryAssignments`; auxiliares de RVT não podem aceitar, iniciar, rejeitar ou concluir.
# Hotfix RVT — preparo e download (2026-08-03)

O `POST /api/v1/rvt-executions/:id/prepare` cria no máximo uma Assignment primária. A criação da
Operation é a autoridade da atribuição inicial; chamadas posteriores reutilizam a Operation e a
Assignment existentes. O contrato de resposta permanece `OperationDetail`.

Quando `operation.documents[]` contiver o documento `TECHNICAL_REPORT` com `status=READY`, o PDF
deve ser obtido pelo contrato oficial `GET /api/v1/documents/:documentId/download`.

### PATCH `/api/v1/assignments/:id/reassign` — equipe da execução RVT

Request compatível e aditivo:

```json
{
  "assignedTo": "uuid-do-responsavel",
  "auxiliaryOperatorIds": ["uuid-do-auxiliar"],
  "notes": "opcional"
}
```

`auxiliaryOperatorIds` é opcional, aceita até 10 UUIDs únicos e é sincronizado atomicamente com a
reatribuição. O responsável é excluído da lista auxiliar. As validações de usuário operacional,
ativo e pertencente à instalação continuam no backend.

Na preparação de RVT, `maintenanceChecklist` contém os grupos `WEEKLY` e `SEMIANNUAL`. Somente os
itens cujo `maintenanceType` coincide com `operation.maintenanceType` podem ter `executed=true`.

O Blueprint de `TECHNICAL_REPORT` preserva dois identificadores distintos: `metadata.documentNumber`
e `header.documentNumber` são o número documental `RVT-*`; o item `Número` da seção de identificação
é `rvtExecution.executionNumber` com três dígitos. RVTs avulsos, sem execução planejada, mantêm o
número documental como fallback compatível.
