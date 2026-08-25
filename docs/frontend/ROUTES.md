# ROUTES — Frontend

## Portal do Cliente

- `/customer/login` — login exclusivo de cliente.
- `/customer/change-password` — troca da senha temporária.
- `/customer` — dados, histórico, equipamentos e chamados.
- `/service-tickets` — Gestão de Chamados para OWNER/MANAGER.

`/login` é OWNER/MANAGER; `/operator/login` é OWNER/OPERATOR. Os três namespaces de token são
independentes.

## Ajustes de endereço e PMOC

- `/clientes` e `/clientes/:id`: cadastro/edição de endereço aceita ponto de referência.
- `/operator/services/:id`: resumo operacional exibe complemento e ponto de referência.
- `/pmoc` e `/pmoc/:id`: datas de cobertura e próximas execuções usam semântica de dia civil.

## `/pmoc/:id`

A aba Execuções apresenta última conclusão e próxima previsão independentes por equipamento.

## `/operator/services`

Lista Operations recentes com concluídas ao final e filtros de status/data agendada.

## `/budgets`

Wizard e detalhe separam descrições informativas de materiais dos itens comerciais valorados.

## `/maintenance-checklists`

As abas `Checklists de Equipamentos` e `Descrições de materiais` reutilizam o CRUD oficial dos
Catálogos Técnicos. Links podem abrir diretamente com `?type=EQUIPMENT_TYPE` ou
`?type=BUDGET_MATERIAL_DESCRIPTION`.

## `/clientes/:id?tab=equipments` e `/budgets`

O cadastro de equipamento consome o catálogo de tipos. O Wizard de orçamento consome descrições
reutilizáveis na etapa Materiais.

## `/operations`

O Wizard de criação permite ao OWNER/MANAGER informar o valor operacional e usa a identificação
técnica enriquecida dos equipamentos.

## `/operator/services` e `/operator/services/:id`

A lista ordena atendimentos por criação decrescente. O detalhe exibe o valor do serviço quando
informado e os Wizards exigem a complementação dos equipamentos originalmente incompletos.

## `/pmoc/[id]`

A aba Execuções apresenta capacidade independente por equipamento. Depois do fim da cobertura,
itens pendentes continuam executáveis e recebem alerta. O plano fica Finalizado somente após todos
os ciclos.

## `/operator/atendimento`

Executar PMOC mostra progresso, pendências e numeração própria do equipamento selecionado.

## `/pmoc`

- `Novo PMOC` cria somente a configuração do plano.
- Não cria execução, OS ou documento ao concluir.
- `/pmoc/:id` mantém edição das predefinições e os fluxos operacionais existentes.

## `/clientes/:id`

- Visão Geral: KPIs operacionais, cadastro, endereços, contatos gerenciáveis e atendimentos recentes.
- Serviços: listagem paginada e criação contextual de atendimento.
- O cliente permanece fixo ao abrir o drawer pela página; nenhuma rota adicional foi criada.

## `/clientes/:id` → Vendas → Criar recibo

O atalho abre `/reports?create=RECEIPT&saleId=:id`. O Wizard consome o prefill da venda concluída,
identifica o cliente por nome/CPF/CNPJ e gera uma declaração de venda de produtos antes do Preview.

## `/operacoes` e `/agenda` — OS a partir de PMOC

O drawer oficial oferece origem PMOC. Após escolher plano e execução pendente, o usuário revisa o
prefill completo e só então cria/atribui a OS. Não existe rota, formulário ou criação de Operation
paralela.

## Checklists RVT/PMOC

- `/maintenance-checklists?type=CHECKLIST`: administração dos itens.
- `/reports`: RVT da Platform.
- `/operator/atendimento`: RVT iniciado pelo operador.
- `/operator/execucao/:id`: RVT atribuído.
- `/pmoc`: checklist herdável pelas futuras OS.

## `/operator-executions`

Gestão mensal das execuções dos operadores. Visível somente para OWNER/MANAGER.

## `/operator-executions/[id]`

Histórico e agenda mensal do operador selecionado, com acesso ao drawer oficial da Operation.

## `/operator/atendimento`, `/operator/execucao/[id]` e `/operator/documents`

- `/operator/atendimento`: criação autônoma somente de OS/RVT.
- `/operator/execucao/[id]`: conclui e emite OS/RVT; demais tipos atribuídos seguem para revisão.
- `/operator/documents`: permite visualizar, gerar quando recuperável, baixar e compartilhar PDFs oficiais.

## PMOC — criação

As entradas de criação pelo Wizard PMOC e por `/reports` consultam `GET /api/v1/pmoc/active-coverage` e exigem confirmação visual antes de enviar `confirmActiveCoverage: true` ao endpoint oficial de criação.

## `/reports` — Recibo / Garantia

OWNER/MANAGER iniciam o Recibo manualmente ou por OS concluída no drawer oficial. Nenhuma rota ou
tela paralela foi criada.

Em `/operacoes`, Ordens de Serviço concluídas exibem `Gerar Recibo`. A ação navega para
`/reports?create=RECEIPT&operationId=:id`, abrindo o mesmo Wizard com a origem por OS e o registro
correspondente previamente selecionados.


## PMOC — coleta e revisão

- `/pmoc`: novo PMOC pode preparar fotos e assinatura; havendo coleta, a primeira OS é criada pelo
  fluxo oficial para receber os artefatos.
- `/pmoc/:id`: resumo mostra identidade da coleta; editar/revisar abre o wizard com fotos e
  assinaturas da execução mais recente.
- `/operator/services/:assignmentId`: execução PMOC lista evidências, permite novas fotos, mostra o
  responsável técnico e permite coletar/substituir a assinatura do cliente conforme o Template.

## PMOC UX-02.1

- `/pmoc/:id`: aba Execuções exibe assinatura/evidências e abre o drawer oficial de documento PMOC.
- `/pmoc`: Wizard consulta a política real e mantém override restrito ao plano.
- `/operacoes`: drawer oficial permite registrar evidências e assinatura da execução PMOC.
- `/operator/services/:assignmentId`: exibe todos os equipamentos, progresso mínimo de fotos e
  coleta conforme Template; conclusão permanece autorizada pelo backend.
- `/documentos`: recebe automaticamente o PMOC renderizado pelo Document Engine.

## PMOC UX-02

- `/pmoc`: abre o Wizard profissional de criação.
- `/pmoc/:id`: aba Execuções permite editar uma data individual sem alterar o plano inteiro.
- `/maintenance-checklists?type=PLAN_SCOPE`: abre diretamente os escopos oficiais do plano; novos
  itens são reutilizados pelo Wizard após “Atualizar lista”.

## PMOC Foundation — Bloco 3

- `/pmoc`: dashboard operacional, calendário, próximas/últimas execuções e planos paginados.
- `/pmoc/:id`: resumo enriquecido, Execution Requests paginadas e timeline profissional.
- `/clientes/:id`: card PMOC com plano ativo e navegação contextual.
- `/equipamentos/:id`: card PMOC com plano, status e execuções.
- `/operator/services/:id`: contexto PMOC dentro do fluxo Assignment existente.
- Navegações para `/operacoes` e `/documentos` reutilizam os drawers/viewers canônicos.

## PMOC Foundation — Bloco 2

- `/pmoc`: listagem paginada, métricas e criação profissional do plano.
- `/pmoc/:id`: detalhe operacional com resumo, execuções e timeline.
- `/reports`: permanece Central de Relatórios; iniciar PMOC encaminha para `/pmoc`, evitando dois
  criadores concorrentes.
- `/operator` e `/operator/services/:id`: exibem contexto PMOC quando a Assignment estiver ligada a
  uma execução, sem rota ou workflow paralelo.

## PMOC Foundation

- `/reports`: criação/gestão do PMOC, solicitação e abertura aninhada do wizard oficial de OS.
- `/operacoes`: rota canônica para gerenciar qualquer OS gerada pelo PMOC.
- Nenhuma rota paralela de agenda, OS ou documento foi criada.

## `/reports` — DC-03.1

O workflow `TECHNICAL_OPINION` coleta responsabilidade técnica e dados específicos de inspeção por
equipamento. Não há rota nova; Preview, Render e Download permanecem no Drawer/DocumentViewer.

## DC-03

`/reports` inicia o Laudo Técnico em quatro etapas: Origem → Conteúdo → Assinatura → Preview.
Preview, Render e Download continuam nos endpoints oficiais de `TECHNICAL_OPINION`; o documento
emitido aparece em `/documentos`. Nenhuma rota nova foi adicionada.

A remoção do QR gráfico da Ordem de Serviço não altera rotas. Preview, render, download e lookup de
equipamentos preservam os endpoints atuais.

O refinamento estrutural de `TECHNICAL_REPORT` não cria rotas. `/reports` e `/documentos` continuam
usando o mesmo `DocumentViewer` e os endpoints oficiais de Preview → Render → Download.

O refinamento de header/footer ocorre no `DocumentViewer` compartilhado e não cria nem altera rotas.

## DC-02

Sem rota nova. `/reports` cria/edita a origem `Operation` e abre o `TECHNICAL_REPORT` no
`DocumentViewer`; `/documentos` exibe a emissão oficial via catálogo. `/reports/visita` permanece
redirect para `/reports` e não volta a ser fluxo paralelo.

## Product Backlog Closure 07

- `/reports`: Central de Relatórios.
- `/report-templates`: Modelos de Relatórios, sem emissão.
- `/reports/visita`: redirect para `/reports`.
- `/documentos`: inalterado.
- `/financial`: mesma página, agrupada em Gestão.
- `/settings`: seção Documentos removida.

## DC-01.2

Sem novas rotas. `/operacoes` e `/documentos` continuam abrindo o mesmo `DocumentViewer`; Preview,
render e download permanecem no Document Engine. O QR exibido na OS é o payload oficial do
equipamento e o scanner continua resolvendo-o pela API existente.

## DC-01

`/operacoes`, `/operator/atendimento` e `/documentos` preservam o fluxo Operation → WORK_ORDER →
DocumentViewer → render → download. Nenhuma rota ou preview paralelo foi criado.

## `/documentos` — catálogo oficial D1

Lista todas as origens por `GET /api/v1/documents`, com filtros de tipo, cliente, equipamento,
operador, período, status e busca. A linha abre o `DocumentViewer`; a descoberta por Operations foi
removida.

## Product Backlog Closure 05 — Reports route

- `/reports`: biblioteca de modelos documentais refinada.
  - **Modelo** abre preview estrutural via `GET /documents/templates/:templateId/preview`.
  - **Dados reais** abre preview/render/download via Operation real e Document Engine.
  - O drawer usa `DocumentViewer` para os dois fluxos.
  - Nenhuma rota nova foi criada.

## Product Backlog Closure 05.1 — Visit Report route

- `/reports/visita`: consolidada como workflow de evidências de Operation real.
  - seleciona Operation existente;
  - salva evidências via `PATCH /operations/:id`;
  - pré-visualiza `TECHNICAL_REPORT` via `DocumentViewer`;
  - render/download continuam exclusivos do Document Engine.

## Sprint 23 — V1 product workflow closure

- `/operator/services/[id]`: rota de detalhe de campo refinada.
  - Consome `GET /assignments/:id`;
  - consome `GET /assignments/history/:operationId`;
  - consome `GET /operations/:id/materials`;
  - registra consumo com `POST /operations/:id/materials` quando a Assignment está `STARTED`;
  - abre documentos da Operation com o `DocumentViewer` oficial;
  - não cria preview local, PDF local ou domínio paralelo.

Rotas sem mudança:

- `/operator/services`: continua sendo a fila real de Assignments do operador.
- `/operator/agenda`: continua sendo visão cronológica de Assignments reais.
- `/operacoes` e `/agenda`: continuam usando Operation + Assignment como modelo oficial.

## Sprint 21 — Bundle and runtime notes

Nenhuma rota nova foi criada.

Build de produção em 6 de julho de 2026:

| Rota                      | First Load JS |
| ------------------------- | ------------: |
| `/`                       |        325 kB |
| `/budgets`                |        336 kB |
| `/produtos`               |        330 kB |
| `/equipamentos`           |        449 kB |
| `/financial`              |        325 kB |
| `/purchase-orders`        |        324 kB |
| `/operator`               |        144 kB |
| `/operator/services/[id]` |        144 kB |
| `/operator/atendimento`   |        153 kB |

Regras de rota:

- manter `/operator/*` enxuto e mobile-first;
- não reintroduzir `/servicos` e `/ordens` como telas operacionais paralelas;
- dashboards devem continuar consumindo endpoints paginados/agregados existentes;
- caso staging mostre lentidão no dashboard, priorizar endpoint agregado no backend antes de
  duplicar cálculo no frontend.

## Frontend Sprint 9 — Navigation UX & Creation Flows

Menu lateral:

- Visão Geral: `/`, `/agenda`;
- Operação: `/operacoes`, `/servicos`, `/ordens`, `/documentos`;
- Cadastros: `/clientes`, `/equipamentos`, `/produtos`;
- Gestão: `/reports`, `/financial`, `/usuarios`;
- Sistema: `/settings`, `/profile`.

Novos fluxos:

- `/agenda`: botão **Novo agendamento** abre `OperationCreationDrawer` em modo agenda.
- `/operacoes`: botão **Nova operação** abre `OperationCreationDrawer` em modo operação.
- `/servicos`: botão **Novo serviço** abre o mesmo fluxo, sem criar domínio Service paralelo.
- `/ordens`: botão **Nova OS** cria Operation; o backend gera a OS rascunho relacionada.

Limitação conhecida:

- ainda não existe domínio dedicado de Agenda;
- delegação para operador é capturada visualmente, mas o backend atual atribui a Operation ao ator autenticado;
- edição avançada/preview automático da OS após criação fica para sprint futura.

## Frontend Sprint 8 — Inventory, Materials & Pricing

- `/produtos`: central operacional real para produtos, estoque, fornecedores, pricing e movimentos.
  - Catálogo consome `GET /products`.
  - Detalhe do produto consome estoque associado e `GET /products/:id/pricing` quando permitido.
  - Cadastro/edição consome `POST/PATCH /products`.
  - Desativação consome `DELETE /products/:id`.
  - Estoque consome `GET/PATCH /inventory/:id`, `GET /inventory/stats` e `POST /inventory/movements`.
  - Fornecedores consomem `GET/POST/PATCH/DELETE /suppliers`.
  - Pricing consome `GET /pricing`, `GET /pricing/stats`, `POST /products/:id/pricing`, `PATCH /pricing/:id` e `GET /pricing/history/:productId`.
- `/`: dashboard adiciona widgets reais de Inventory/Pricing.
- `OperationDetailDrawer`: adiciona seção **Materiais utilizados** com:
  - `GET /operations/:id/materials`;
  - `POST /operations/:id/materials`;
  - `DELETE /operations/:id/materials/:id`.

RBAC visual:

- OWNER/MANAGER administram catálogo, estoque e fornecedores;
- OPERATOR pode registrar consumo/movimentação operacional;
- Pricing aparece somente para OWNER/MANAGER;
- revisão de Pricing somente OWNER.

## Backlog — Document Template Preview

- `/reports`: o botão **Visualizar** abre o drawer atual e renderiza o modelo com:
  - `GET /documents/templates/:templateId/preview`;
  - `DocumentViewer source={{ templateId }}`.
- O preview de modelo não depende mais de `/operations`, não cria Operation fictícia e não tem fallback local.
- Templates sem registro persistido exibem estado "Template indisponível"; templates inativos/erros de renderização são tratados pelo `DocumentViewer`.

## Backlog — Paginação Global + Modelos de Relatórios

- `/reports`: agora é a biblioteca de **Modelos de Documentos**, não lista documentos emitidos.
  - Cards mostram ícone, nome, descrição, status, assinatura obrigatória, modo/fixa, template padrão e última atualização.
  - **Visualizar** abre drawer com duas colunas: metadados/configuração à esquerda e `DocumentViewer` à direita.
  - O preview usa exclusivamente o backend (`/documents/templates/:templateId/preview`) através do `DocumentViewer`.
  - **Configurar** abre o `TemplateFormDrawer` existente.
  - **Novo Modelo** abre o mesmo drawer, escolhendo o tipo no cabeçalho.
- `/clientes`, `/equipamentos`, `/operacoes`, `/usuarios`, `/documentos`, `/servicos`, `/ordens`, `/produtos` e `/financial`: usam o componente padrão de paginação.
- `/documentos`: mantém a Central Documental real, paginada pela consulta de `/operations`.

## Sprint 7 — Asset Lifecycle

- `/equipamentos/[id]`: detalhes do equipamento com abas Resumo, Informações, Timeline,
  Documentos, Métricas e Anexos. Timeline consome `/equipments/:id/lifecycle` e stats consomem
  `/equipments/:id/lifecycle/stats`.
- `/clientes/[id]`: timeline consolidada do cliente via `/asset-lifecycle?customerId=...`.
- `/`: dashboard adiciona widgets reais de ciclo de vida usando `/asset-lifecycle`.
- `/operator/equipamentos/[id]`: PWA/operator usa o mesmo `AssetTimeline`.
- `CustomerDetailDrawer`, `EquipmentDetailDrawer` e `OperationDetailDrawer`: históricos usam
  Asset Lifecycle, sem timeline local.

Eventos de timeline:

- `documentId` abre `DocumentViewer`;
- `operationId` abre `OperationDetailDrawer`.

## Sprint 6 — Documentos

- `/documentos`: Central Documental real. Consome `/operations` para listar `OperationDocument` e abre `DocumentViewer` com endpoints oficiais de preview/render/download.
- `/settings`: inclui seções **Documentos** (`GET /documents/configuration`) e **Assinaturas** (`/signatures`).
- `/reports`: Gestão de Modelos/Templates. Exibe configuração real dos templates e administra assinatura por template.
- `/operator/documents`: documentos reais filtrados pelo cliente selecionado; usa `/operations?customerId=...` e `DocumentViewer`.
- `OperationDetailDrawer`: documentos relacionados abrem o mesmo `DocumentViewer`.

Rotas antigas de preview local/demo foram removidas das telas de documentos. Ordens/Serviços demo não exibem mais rascunho local de documento.

Dois apps no mesmo runtime Next, separados por pathname (`app/app-providers.tsx`). Ver `ARCHITECTURE.md`.

## Platform (gestão · desktop-first)

`/login`, `/trocar-senha` (escopo platform) + shell autenticado em `app/(platform)/…`:
`/`, `/agenda`, `/operacoes`, `/servicos`, `/ordens`, `/clientes` (+`/[id]`), `/equipamentos` (+`/[id]`), `/produtos`, `/budgets`, `/financial`, `/purchase-orders`, `/usuarios`, `/profile`, `/settings`, `/reports` (+`/visita`) e `/documentos`. Todas consomem domínios reais; `/servicos` e `/ordens` são redirects legados para operações.

### Budget / Comercial

- `/budgets`: Central Comercial real.
  - Consome `/budgets`, `/budgets/stats`, `/budgets/history/:id`;
  - cria orçamentos via `POST /budgets`;
  - aprova/rejeita/cancela por endpoints oficiais;
  - documento comercial usa `POST /budgets/:id/render` + `GET /budgets/:id/download`;
  - visualização usa `DocumentViewer` com `documentId` oficial;
  - visível no menu para `OWNER` e `MANAGER`.

- `OperationDetailDrawer`:
  - seção **Orçamentos** consome `/operations/:id/budgets`;
  - cria orçamento vinculado à Operation;
  - não cria fluxo comercial paralelo.

### Product UX Polish — Sprint 18

Rotas operacionais legadas:

- `/servicos` → redireciona para `/operacoes`;
- `/ordens` → redireciona para `/operacoes`;
- `/ordens/[id]` → redireciona para `/ordens`;
- `/produtos/[id]` → redireciona para `/produtos`;
- a antiga `/demo-ready` foi removida; não existe modo de apresentação baseado em dataset.

Motivo: evitar dead UI, Demo Dataset e placeholders. A fonte operacional V1 é `Operation` + `Assignment` + `Document Engine`.

Sidebar final:

- Visão Geral: Dashboard, Agenda.
- Operação: Operações, Documentos.
- Cadastros: Clientes, Equipamentos, Produtos, Fornecedores.
- Financeiro: Financeiro.
- Compras: Pedidos de Compra.
- Gestão: Relatórios, Orçamentos, Usuários.
- Sistema: Configurações, Perfil.

Deep-links suportados:

- `/operacoes?status=IN_PROGRESS`;
- `/financial?status=OVERDUE`;
- `/financial?type=RECEIVABLE&status=PENDING`;
- `/purchase-orders?status=SENT`;
- `/produtos?tab=inventory`;
- `/produtos?tab=suppliers`;
- `/produtos?tab=pricing`;
- `/produtos?tab=movements`.

Parâmetros inválidos são ignorados e a tela volta ao estado padrão seguro.

### Financial / Financeiro

- `/financial`: módulo financeiro real.
  - dashboard via `GET /financial/stats`;
  - contas via `/financial/accounts`;
  - categorias via `/financial/categories`;
  - lançamentos via `/financial/entries`;
  - histórico via `/financial/history/:id`;
  - ações de pagamento/cancelamento por endpoints oficiais;
  - visível para `OWNER`/`MANAGER` com `canFinancial`.

### Procurement / Compras

- `/purchase-orders`: pedidos de compra reais.
  - lista e filtros via `GET /purchase-orders`;
  - métricas via `GET /purchase-orders/stats`;
  - detalhe via `GET /purchase-orders/:id`;
  - criação/edição/envio/cancelamento via endpoints oficiais;
  - itens via `/purchase-orders/:id/items` e `/purchase-order-items/:id`;
  - recebimentos parciais/totais via `POST /purchase-orders/:id/receipts`;
  - histórico via `GET /purchase-orders/history/:id`;
  - visível para `OWNER` e `MANAGER`.

Menu Platform:

- “Financeiro” e “Compras” agora são grupos próprios;
- “Modo Demo” foi removido da sidebar;
- “Fornecedores” aparece em Cadastros apontando para a área existente de Produtos/Fornecedores.

### Executive Dashboard

- `/`: dashboard executivo/operacional oficial da V1.
  - não consome Demo Dataset;
  - não usa `dashboardApi`;
  - consolida dados reais de Assignments, Operations, Financial, Maintenance, PMOC, Inventory, Procurement e Asset Lifecycle;
  - usa seletor controlado de período para atividade recente: Hoje, 7 dias, 30 dias e Mês atual;
  - links levam para `/agenda`, `/operacoes`, `/financial`, `/produtos`, `/purchase-orders` e `/equipamentos`;
  - Financial é visível/requisitado apenas para roles autorizadas;
  - Procurement é visível/requisitado apenas para `OWNER`/`MANAGER`.

## Operator (campo · mobile-first)

Sessão escopo `operator`. Três zonas sob `app/operator/`:

| Zona                 | Layout                                                          | Rotas                                                                                                                                                                                                                       |
| -------------------- | --------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Público              | `operator/layout.tsx` (mínimo)                                  | `/operator/login`, `/operator/trocar-senha`                                                                                                                                                                                 |
| Shell (nav inferior) | `operator/(shell)/layout.tsx` (`RequireAuth` + `OperatorShell`) | `/operator` (Home), `/operator/agenda`, `/operator/services` (+`/[id]`), `/operator/clientes` (+`/[id]`), `/operator/equipamentos` (+`/[id]`), `/operator/qr`, `/operator/documents`, `/operator/sync`, `/operator/profile` |
| Full-screen          | `operator/(full)/layout.tsx` (`RequireAuth`, sem nav)           | `/operator/atendimento` (Wizard)                                                                                                                                                                                            |

Navegação inferior: Início · Agenda · Atendimentos · Clientes · Perfil.

### Assignment Workflow

- `/agenda`: Platform visualiza Assignments reais em calendário; não usa agenda paralela.
- `/operacoes`: `OperationDetailDrawer` exibe seção Assignment e permite reatribuição para
  OWNER/MANAGER.
- `/operator`: Home de campo com métricas Hoje, Em andamento, Próximas e Atrasadas via
  `/assignments/my`.
- `/operator/services`: Minhas Ordens, lista de Assignments reais.
- `/operator/services/[id]`: detalhe da Assignment com aceitar, recusar, iniciar e concluir.
- `/operator/agenda`: agenda cronológica do operador baseada em Assignments.

### Wizard de atendimento (`/operator/atendimento`)

10 etapas: Cliente → Endereço → Equipamento → Tipo → Checklist → Observações → Fotos → Assinatura → Resumo → Enviar (sucesso). Full-screen, fora do shell (sem bottom nav).

## PWA

`app/manifest.ts` gera `/manifest.webmanifest` (app instalável = Operator, `start_url`/`scope` `/operator`). Instalação via Perfil do operador (`@erp/ui/pwa/install-button`).

## Produção (deploy futuro)

`erp.empresa.com.br` → Platform · `operator.empresa.com.br` → Operator · ambos consomem `api.empresa.com.br`.

## Sprint 20.5 — Route Security Notes

Nenhuma rota frontend nova foi criada. Rotas que exibem Asset Lifecycle devem consumir apenas payload público sanitizado e não devem montar URLs a partir de storage keys. A rota de visita técnica corrigiu cleanup de object URLs para previews locais.

## Sprint 22 — release smoke routes

The official frontend smoke runner validates these routes against a production build:

- `/login`
- `/`
- `/clientes`
- `/equipamentos`
- `/operacoes`
- `/documentos`
- `/budgets`
- `/financial`
- `/purchase-orders`
- `/operator/login`

Command:

```bash
ORBIT_RELEASE_API_URL=<api-base-url> \
ORBIT_RELEASE_FRONTEND_URL=<frontend-base-url> \
ORBIT_RELEASE_OWNER_EMAIL=<owner-email> \
ORBIT_RELEASE_OWNER_PASSWORD=<owner-password> \
npm run release:smoke:frontend
```

## Sprint 22.5 — external route validation status

No route contract changed.

The Sprint 22 local smoke route list remains valid, but external HTTPS route validation was not
executed because no external environment/hostname was available in the workspace.

## Product Backlog Closure 01 — route behavior

Nenhuma rota nova foi criada.

Rotas impactadas:

- `/produtos`
  - botão superior permanece focado em “Novo produto”;
  - preço é criado/revisado pela aba Preços;
  - fornecedor pode ser gerenciado na aba Fornecedores e também selecionado como fornecedor principal
    no drawer de produto via relação backend `ProductSupplier`.
- `/clientes`
  - drawer de criação permite endereço inicial usando o contrato existente de endereços do cliente;
  - retries de endereço não recriam o cliente.
- `/equipamentos`
  - seleção de endereço continua restrita ao cliente selecionado;
  - a ausência de endereço do cliente é informada no formulário.
- `/reports`
  - drawer foi reorganizado verticalmente para priorizar leitura do preview.

## Product Backlog Closure 02 — route behavior

- `/reports`
  - passa a funcionar como entry point de workflow documental por Operation real;
  - o drawer seleciona uma Operation e usa `GET/POST /documents/operations/:operationId/:type/*`;
  - render/download deixam de ficar desabilitados quando há Operation real e template suportado.
- `/documentos`
  - permanece como repositório/histórico oficial de documentos emitidos;
  - documentos emitidos via Reports aparecem pela relação `OperationDocument` existente.

Nenhuma rota nova foi criada.

## Document Semantics Closure — route behavior

- `/reports`
  - cards exibem “Visualizar modelo” e “Pré-visualizar com dados reais” separadamente;
  - modelo não exige Operation;
  - dados reais exigem Operation.
- `/documentos`
  - filtros incluem `TECHNICAL_OPINION`;
  - documentos `REPORT` continuam legíveis como legado.

## Product Backlog Closure 03 — route behavior

- `/operacoes`: export PDF consome `GET /operations/export` com filtros ativos.
- `/documentos`: export PDF consome `GET /documents/export` com filtros ativos.
- `/equipamentos`: export PDF consome `GET /equipments/export` com filtros ativos.
- `/settings`: gestão de assinaturas usa Drawer, upload e desenho freehand; deletadas não aparecem.

## Product Backlog Closure 04 — route behavior

- `/profile`: seleção de avatar abre recorte antes do upload oficial;
- shell Platform: sino abre Notification Center real;
- Operator home/header: sino usa notificações reais;
- action URLs de notificação navegam apenas para rotas existentes como `/operacoes` e `/budgets`.

# Closure 06

- `/operacoes`: colunas Criado e Data do agendamento; drawer com datas e assinatura da OS.
- `/operator/services/:id`: agendamento destacado e criação apresentada como contexto secundário.
- `/operator/agenda`: Operations sem `scheduledFor` ficam em “Não agendado”.
- `/reports`: “Visualizar modelo” usa template; preview real usa Operation e tipo documental explícito.

# Closure 06.1

- `/operacoes`: rota ativa inspecionada em runtime; tabela e drawer aprovados.
- Drawer da OS em `/operacoes`: preview real integral, sem clipping por drawer pai.
- `/operator`: mantém `scheduledFor` como data operacional; nenhuma rota paralela criada.

## DC02B

- `/reports`: workflow do Relatório de Visita Técnica com competência, manutenção, checklists e
  equipamentos filtrados pelo cliente; Preview/Render/Download oficiais.
- `/settings`: inscrição estadual e telefones alimentam o Corporate Header de todos os documentos.

# `/maintenance-checklists`

Rota preservada e renomeada visualmente para **Catálogos Técnicos**. Possui tabs de Checklist,
Objetivos, Condições Observadas, Conclusões e Recomendações. OWNER/MANAGER gerenciam; VIEWER consulta.
Consome `/api/v1/technical-catalogs`; o adapter `/maintenance-checklist-templates` permanece apenas
para compatibilidade dos fluxos existentes.

## `/reports` — Laudo Técnico e Catálogos

O wizard `TECHNICAL_OPINION` seleciona assinatura institucional ativa, múltiplos equipamentos,
objetivos, condições, recomendações e conclusões. A Platform permite editar o texto completo após a
seleção. O Preview continua sendo solicitado somente depois da persistência na Operation.

## `/operator/atendimento` — Catálogos

Equipamentos são selecionados por lista de checkboxes (até 100 registros filtrados do cliente).
Objetivos, condições, recomendações e conclusões reutilizam os seletores técnicos compactos; os
valores finais são enviados à Operation real.

# `/reports` — Ordem de Serviço

O card Ordem de Serviço abre um wizard com origem por Operation concluída ou preenchimento novo. O
modo novo cria uma Operation DRAFT oficial e segue Preview → Render → Download no mesmo drawer.

## Closure 08.1

- `/maintenance-checklists`: gestão/filtros por tipo, área, workflow, status e busca.
- `/reports`: Laudo e Visita enviam contexto técnico aos seletores, sem mudar emissão.
- `/operator/atendimento`: usa o mesmo contrato contextual em composição compacta.

## DC-04

- `/reports`: criação e emissão PMOC pela cadeia oficial.
- `/operator/services/:id`: preenchimento PMOC aparece somente quando a Operation atribuída está
  ligada a uma `MaintenanceExecution` de PMOC.
- `/documentos`: recebe o documento PMOC oficial após renderização.

## Laudo Técnico

- `/reports`: no workflow `TECHNICAL_OPINION`, Objetivo e Conclusão possuem texto técnico principal
  e seleção de itens complementares persistidos separadamente.

## PMOC

- `/reports`: o passo Origem permite criar PMOC independente ou selecionar/administrar um plano
  existente. A OS oficial é criada somente depois do PMOC e vinculada à sua execução.

## PMOC UX-01

- `/pmoc`: criação com múltiplos equipamentos/tipos e política do Template.
- `/pmoc/:id`: cobertura, serviços e programação com labels de negócio.
- `/operator/services/:id`: todos os equipamentos/tipos; coleta somente quando exigida.
- `/reports`: preserva o mesmo wizard e a geração oficial da OS.

## Field Report Handoff 01

- `/operator/services/:id`: coleta e submissão dos cinco tipos documentais permitidos ao Operator.
- `/reports`: caixa de entrada, filtros, revisão e emissão por OWNER/MANAGER.
- `/documentos`: repositório oficial com estado editorial, versão/revisão e Viewer oficial.
- Nenhuma rota nova de PDF, preview, PMOC, OS ou assinatura foi criada.

## PMOC FIX-01

- `/pmoc/:id`: ações e estado do PDF oficial da execução mais recente; execuções anteriores mantêm
  a mesma ação individual na aba Execuções.
- `/documentos`: recebe o PMOC automaticamente após renderização. Nenhuma rota frontend nova.
# PMOC FIX-02A

- `/pmoc/:id`: OWNER/MANAGER visualizam a ação “Revisar assinaturas”, que abre o Wizard oficial em modo de revisão sem criar rota adicional.

## PMOC FIX-02B

- `/pmoc/:id`: OWNER/MANAGER visualizam **Revisar evidências**, que abre o Wizard oficial na etapa Evidências. Nenhuma rota frontend foi adicionada.

## Operator — início autônomo

- `/operator`: CTA **Iniciar atendimento ou relatório**.
- `/operator/atendimento`: seletor de OS, Relatório de Visita, Laudo, Orçamento ou execução PMOC elegível.
- `/operator/services`: lista unificada de atividades atribuídas e iniciadas pelo operador.
- `/operator/services/:id`: continua sendo o único fluxo de execução, coleta e devolução para revisão.

## PMOC — navegação consolidada

- `/pmoc?tab` não cria rotas adicionais: as tabs locais **Visão geral** e **Agenda dos PMOCs** compartilham o mesmo estado oficial.
- `/pmoc`: Visão geral mostra indicadores, status dos planos e criação; Agenda mostra calendário, busca, filtros e listas temporais.
- `/pmoc/:id`: informações, edição, ajustes operacionais, documentos, execuções, timeline e finalização por OWNER.
## DC-06

- /budgets: central comercial, wizard manual/OS concluída, edição pré-emissão e documento oficial.
- Nenhuma rota adicional: a aba Orçamentos da Operation abre o mesmo BudgetWizardDrawer com a OS preselecionada.
# Customer-centric routes

- `/clientes`: listagem; clique na linha abre `/clientes/:id`; edição usa ícone dedicado.
- `/clientes/:id`: visão geral e gestão relacionada de equipamentos, serviços e vendas.
- `/equipamentos`: rota legada redireciona para `/clientes` (ou `/clientes/:customerId`).
- `/equipamentos/:id`: detalhe do ativo preservado.
- `/reports?create=RECEIPT&saleId=:id`: inicia Recibo preenchido por venda concluída.
# `/operator/trocar-senha`

Rota obrigatória no primeiro login. Etapas: senha definitiva → dados profissionais e assinatura → encerramento da sessão → novo login.
# Produtos por finalidade comercial

- `/produtos?tab=purchased`: produtos habilitados para compra.
- `/produtos?tab=sold`: produtos habilitados para venda.
- `/clientes/:id`, aba Vendas: cria vendas usando exclusivamente produtos da classificação de venda.
# Cadastro de produto

Em `/produtos?tab=purchased` e `/produtos?tab=sold`, “Novo produto” abre o mesmo formulário simplificado. A aba de origem define a finalidade inicial; códigos são sugeridos e valores são persistidos por Pricing.
# Estoque e vendas do cliente

- `/produtos?tab=inventory`: o detalhe do item concentra configurações e movimentações simplificadas.
- `/clientes/:id`, aba Vendas: produtos são resolvidos pelo preço vigente na data escolhida; itens sem preço não aparecem como selecionáveis.

# Operator — criação e execução de OS/RVT — 2026-07-22

- `/operator/atendimento`: criação autônoma de OS/RVT com fluxo completo e assinatura obrigatória antes da confirmação.
- `/operator/execucao/:id`: execução atribuída com conteúdo equivalente à Platform, evidências, materiais e etapa obrigatória de assinatura quando ainda não coletada.
- Ambas permanecem sobre Operation → Assignment → Handoff; nenhuma rota ou fluxo documental paralelo foi criado.

Em ambas as rotas, `WORK_ORDER` e `TECHNICAL_REPORT` concluem, finalizam o handoff e renderizam o PDF oficial no próprio fluxo do Operator. Não há redirecionamento para aprovação da gestão.

- `/operator/profile#assinatura-tecnica`: configura a assinatura institucional vinculada ao Operator.
- `/operator/atendimento` e `/operator/execucao/:id`: pré-selecionam essa assinatura para OS/RVT e exigem confirmação antes da assinatura do cliente/conclusão.
## Ajuste funcional — Operator

- O wizard acessível pelo início autônomo de uma Ordem de Serviço mantém a etapa opcional de checklist, com seleção dos itens oficiais e registro imediato como executados.
## `/maintenance-checklists?type=RVT_CHECKLIST`

Abre a aba administrativa exclusiva dos itens Semanais e Semestrais do Relatório de Visita
Técnica. A rota física permanece única; `RVT_CHECKLIST` é somente uma chave de apresentação para
o filtro oficial `CHECKLIST + TECHNICAL_REPORT`.

## `/pmoc/:id`

- `Resumo`: dados do plano e equipamentos cobertos com paginação.
- `Execuções`: uma linha por equipamento, histórico mais recente e ação `Executar`.
- `Timeline`: conteúdo oficial preservado.

O wizard abre na rota atual. Preview, render e download continuam no drawer com
`DocumentViewer`.

## `/clientes/:id` — ação de equipamento

- Na aba Equipamentos, clicar no conteúdo da linha navega para `/equipamentos/:id`.
- Clicar no ícone Editar abre exclusivamente o `EquipmentFormDrawer`, sem alterar a rota.

## `/reports` — Recibo originado por OS

- A Ordem de Serviço fornece cliente, endereço e conteúdo para preenchimento inicial.
- A data do Recibo é sempre iniciada com a data local da nova emissão e permanece editável.

## `/operator/services/:id` — cancelamento

- Atendimentos não concluídos oferecem “Cancelar atendimento”.
- Após confirmar, o PDF oficial é gerado e a própria rota apresenta a tela de conclusão.
- A conclusão oferece Compartilhar, Baixar, Ver em Documentos, Minhas ordens e Voltar ao início;
  o visualizador não é aberto automaticamente.
- Telefone do cliente aparece no cartão operacional do topo.

## `/operacoes` — análise de cancelamentos

- O filtro Canceladas inclui solicitações do operador e cancelamentos aprovados.
- O drawer da Operation concentra relatório, reagendamento e aprovação definitiva.
# PMOC no Operator

- `/operator/atendimento`: para OWNER, a opção “Executar PMOC” seleciona plano ativo e equipamento
  coberto. A rota não configura nem cria um plano PMOC.
- Ao concluir, permanece na mesma rota exibindo ações para compartilhar, baixar ou abrir o
  Repositório Documental.
# `/operator/execucao/:assignmentId` — OS sem equipamento

No passo Conteúdo, uma OS sem ativos vinculados habilita coleta/cadastro de equipamentos. A rota
permanece a mesma após o vínculo e utiliza a resposta oficial na conferência e emissão documental.

# `/reports` — ciclo de rascunho

O draft local é recuperável apenas antes da materialização. Preparar Preview, finalizar revisão ou
renderizar o documento desativa o autosave e remove a chave `erp:draft:reports:new:{type}`.

# `/operator/atendimento` — OS avulsa de cliente novo

A opção “OS avulso — cliente novo” coleta cliente, endereço, contato e uma coleção de equipamentos
no primeiro passo. Todos os ativos criados são incluídos na mesma OS e no documento oficial.

## RVT Planning (2026-08-03)

| Rota | Finalidade |
| --- | --- |
| `/rvt` | Catálogo paginado e criação da configuração |
| `/rvt/[id]` | Detalhe e ocorrências individuais |
| `/operator/atendimento` | RVT avulso ou seleção de ocorrência configurada |
| `/operator/execucao/[id]` | Coleta/conclusão da Assignment RVT |

`/reports` encaminha `TECHNICAL_REPORT` para `/rvt?create=1`.

Em `/rvt/[id]`, “gerenciar atribuição” prepara/repara a Assignment e abre o `OperationDetailDrawer`
na própria rota, sem redirecionar para `/operacoes`. OWNER/MANAGER podem selecionar e confirmar o
operador no drawer. “Executar RVT agora” reatribui a ocorrência ao usuário atual, inicia a Assignment
e abre o wizard em um drawer da própria Platform, mantendo `/rvt/[id]`. A rota
`/operator/execucao/[id]` é utilizada somente pelo PWA.

Assignments RVT com `isPrimary=false` abrem no PWA somente para consulta; apenas o Técnico em Campo
principal possui ações de aceite, início, cancelamento e conclusão.

Em `/operator/execucao/[id]` e `/operator/atendimento`, novos equipamentos são preenchidos um por
vez e só entram no comando da API após a confirmação “Adicionar equipamento”.

O acesso ao wizard pela Platform não depende de uma atribuição previamente existente: o `prepare`
garante ou repara a Assignment antes da navegação.

O download de uma execução concluída permanece em `/rvt/[id]` e baixa o PDF autenticado associado,
sem redirecionar o usuário para `/documentos`.

Após concluir um RVT atribuído em `/operator/services/:assignmentId/execute`, a rota permanece no
fluxo Operator e apresenta a tela padrão de documento pronto. As ações levam a `/operator`,
`/operator/documents` ou `/operator/atendimento`; download e compartilhamento usam o documento
recém-renderizado.

Não houve nova rota para a correção do número da execução; Preview e PDF continuam nos contratos
oficiais do Document Engine já consumidos pelas rotas RVT.
