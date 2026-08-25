# STATE — Frontend

## Recibo com descrição única — 2026-08-24

- O Wizard da Central de Relatórios removeu o campo redundante `Serviço prestado` e mantém apenas
  a descrição dos serviços ou da venda.
- Declaração automática, Preview e PDF passam a consumir a mesma descrição, preservando a edição
  manual do texto e a distinção gramatical entre prestação de serviços e venda.

## Portal do Cliente e Chamados — 2026-08-21

- Novas rotas `/customer/login`, `/customer/change-password`, `/customer` e `/service-tickets`.
- Portal responsivo com dados, histórico, equipamentos e chamados reais; sessão `customer` isolada.
- Cliente abre OS/RVT/Laudo com endereço opcional e multiseleção de equipamentos.
- Cliente 360 gerencia acessos, senha temporária, reset e desativação.
- Gestão > Usuários separa `Equipe interna` de `Portal do cliente`; a segunda visão lista os acessos
  externos com busca, status, paginação, último acesso e cliente vinculado.
- Central de Chamados possui KPIs, busca, status, paginação e reutiliza o wizard oficial de
  Operation/Assignment.

## Hotfix RVT — atribuição e download (2026-08-03)

- Abrir detalhes de uma ocorrência pode preparar a Operation sem conflito de Assignment duplicada.
- O ícone de download da execução concluída baixa o PDF RVT diretamente pelo Document Engine,
  mantendo o usuário na página de detalhes.
- Erros de download são apresentados no estado de erro da própria página.

## Hotfix do executor RVT na Platform (2026-08-03)

- O executor continua dentro do drawer da Platform e envia a equipe auxiliar pelo contrato oficial
  da Operation.
- O corpo do drawer agora reserva toda a altura útil ao wizard: cabeçalho e rodapé permanecem
  estáveis, somente o conteúdo da etapa rola e `Continuar`/`Confirmar` ficam na base do painel.
- `Drawer.contentClassName` permite esse layout sem duplicar o shell ou alterar os demais drawers.

## Atendimento mobile e calendário PMOC (2026-07-28)

- O resumo do atendimento mostra complemento e ponto de referência do endereço.
- Os formulários oficiais de endereço permitem cadastrar/editar ponto de referência opcional.
- Resumo, listagem e próxima execução PMOC preservam o dia civil sem deslocamento por fuso.
- Status do orçamento no Preview/PDF é traduzido pelo Document Engine.

## Refinamentos PMOC, Operator e Budget (2026-07-28)

- Execuções PMOC mostram progresso real, última conclusão, próxima data e status por equipamento.
- Meus Atendimentos ordena por número da Operation, usa agenda como desempate, mantém concluídas no
  final e oferece filtros de status/data.
- Materiais do orçamento separam descrições sem preço de itens comerciais.
- Preview, PDF e detalhe ocultam valores dos itens originados no catálogo.

## Catálogos de equipamentos e materiais (2026-07-28)

- Catálogos Técnicos ganhou as abas `Checklists de Equipamentos` e `Descrições de materiais`.
- O cadastro de equipamento usa somente tipos ativos do backend e preserva tipos arquivados durante
  edição de registros antigos.
- A etapa Materiais do orçamento possui o multi-select `Descrição dos Materiais`.
- Seleções viram itens editáveis com quantidade, unidade e valor; os snapshots permanecem
  independentes do catálogo.

## Operações — valor do serviço e equipamentos (2026-07-28)

- O Wizard gerencial possui valor operacional no passo Execução; ele é exibido ao técnico no
  detalhe do atendimento e não aparece em documentos.
- Seletores de equipamento exibem marca, modelo e capacidade no título e setor no subtítulo.
- Os Wizards Operator, atribuídos ou iniciados no mobile, solicitam os campos técnicos ausentes de
  cada equipamento antes da conclusão.
- Atendimentos estão ordenados do mais recente para o mais antigo.
- O rótulo oficial foi ajustado para `Auxiliar Técnico`.

## PMOC — ciclos por equipamento e encerramento (2026-07-28)

- Platform e Operator exibem sequência independente por equipamento.
- O detalhe separa ciclos configurados do total operacional dos ativos.
- A aba Execuções mostra progresso individual e alerta de cobertura encerrada com pendências.
- Equipamentos concluídos não oferecem nova execução; PMOC `COMPLETED` aparece como Finalizado.

## PMOC — Wizard de configuração do plano (2026-07-27)

- `Novo PMOC` abre quatro passos: Identificação e cobertura, Planejamento, Execuções e Confirmação.
- Evidências e Documento não fazem parte do cadastro do plano.
- Planejamento oferece Geração com revisão (padrão) e Programação pausada.
- Técnico padrão lista OWNERs ativos com assinatura própria, vinculada automaticamente.
- Checklist inicia com todas as unidades e itens marcados, permitindo desmarcar grupo ou item.
- A conclusão envia `configurationOnly=true` e não gera OS, Preview ou PDF.

## Cliente 360 — Visão Geral e Serviços (2026-07-23)

- Visão Geral recebeu KPIs reais de atendimentos, identificação reorganizada, endereços responsivos e lista das cinco operações recentes.
- Contatos podem ser adicionados, editados e excluídos com confirmação por OWNER/MANAGER; contato principal utiliza a regra oficial do backend.
- Serviços recebeu “Novo atendimento”, abrindo o `OperationCreationDrawer` com cliente predefinido/bloqueado e endereço/equipamentos contextuais.
- Status, tipos e documentos aparecem em pt-BR pelas fontes compartilhadas.

## Recibo de venda — declaração corrigida (2026-07-23)

- A seleção de uma venda concluída gera imediatamente a declaração com o cliente real, incluindo CNPJ/CPF.
- A origem `SALE` usa redação de venda de produtos; OS/manual usam redação de serviços prestados.
- Itens vendidos e observações aparecem juntos, com labels adequados no formulário.
- O carregamento assíncrono do cliente não grava mais o placeholder `{CLIENTE}`.

## PMOC → Ordem de Serviço revisável (2026-07-23)

- “A partir de um PMOC” não gera mais uma OS ao primeiro clique. A seleção da execução carrega o prefill e abre as cinco etapas do `OperationCreationDrawer`.
- Cliente, local e equipamentos cobertos aparecem como dados herdados e protegidos; operador, agenda, checklist e conteúdo podem ser conferidos antes da criação.
- O resumo identifica PMOC, número da execução, data prevista, equipamentos e procedimentos. É possível trocar a execução sem fechar o drawer.
- A última etapa chama somente `generateWorkOrder`; Assignment e vínculo PMOC continuam sob autoridade do backend.

## RVT/PMOC — checklist oficial (2026-07-22)

- RVT Platform e Operator exibem seleção Semanal/Semestral e os dois checklists oficiais.
- O resumo mobile informa tipo realizado; recomendações e fotos são opcionais.
- PMOC seleciona itens de OS e permite não enviá-los às futuras execuções.
- Catálogos Técnicos identifica “Checklists de manutenção” como fonte única.

## Gestão — Execuções dos Operadores (2026-07-22)

- Nova rota `/operator-executions` para OWNER/MANAGER com KPIs mensais e tabela comparativa baseada na API real.
- O detalhe `/operator-executions/[id]` possui histórico e agenda registrada, filtros mensais/status, paginação e abertura do `OperationDetailDrawer` existente.
- O menu Gestão recebeu “Execuções dos Operadores”. Nenhuma comissão ou métrica é calculada localmente.
- A resolução de escopo em `AppProviders` agora reconhece somente `/operator` e `/operator/*` como app mobile; `/operator-executions` permanece corretamente sob Auth e Command Palette da Platform.

## Operator — OS/RVT com emissão direta (2026-07-22)

- A tela Novo Atendimento oferece somente Ordem de Serviço e Relatório de Visita Técnica.
- PMOC e demais relatórios não possuem mais entrada autônoma; continuam disponíveis na fila quando atribuídos pela gestão.
- OS/RVT autoiniciadas ou atribuídas concluem diretamente, geram o PDF oficial e direcionam para download/compartilhamento.
- A tela Documentos permite recuperar a emissão de OS/RVT concluídas caso o render anterior não tenha terminado.
- Tipos especiais mantêm a mensagem e o estado de revisão.

## PMOC — confirmação de cobertura ativa (2026-07-22)

- O Wizard oficial consulta coberturas ativas ao selecionar um cliente em uma nova criação.
- Coberturas existentes são apresentadas em aviso contextual e em confirmação explícita, sem impedir a decisão do Owner/Manager.
- O fluxo da Central de Relatórios aplica a mesma precondição.
- Edição e revisão de PMOCs existentes não disparam a confirmação.
- O backend permanece como autoridade e respostas `409` também abrem o fluxo de confirmação.

## DC-05 — Recibo / Garantia (2026-07-18)

- Central de Relatórios oferece Recibo para OWNER/MANAGER em cinco etapas: origem, dados, garantia,
  assinatura técnica e Preview.
- Origem manual e OS concluída compartilham campos editáveis; orçamento aprovado apenas acelera o
  valor. Valor por extenso pt-BR e declaração são gerados e permanecem editáveis.
- RECEIPT não mostra assinatura do cliente nem evidência fotográfica.


## PMOC — evidências e assinaturas em todos os fluxos (2026-07-18)

- Wizard Platform de criação/edição/revisão possui etapas funcionais de evidências e assinaturas.
- Fotos preparadas durante novo cadastro são vinculadas à primeira OS oficial; edição usa a última
  execução existente e permite listar, adicionar, legendar e remover pelo fluxo atual.
- Operator mostra fotos persistidas, permite novas evidências, exibe responsável/assinatura técnica
  e coleta ou substitui a assinatura do cliente pelo Handoff oficial.
- Detalhe PMOC mostra responsável técnico, assinatura institucional, cliente signatário, data e
  operador que realizou a coleta.

## PMOC UX-02.1 — fechamento dos quatro fluxos críticos

- Wizard não usa mais `NONE` como fallback: loading/erro da configuração são explícitos e a política
  FIXED/COLLECTED/HYBRID real permanece visível.
- Detalhe PMOC oferece drawer documental oficial com status de assinatura, progresso das quatro
  evidências e `DocumentViewer` para Preview, Render, Rerender stale e Download.
- `OperationCreationDrawer` usa MultiSelect e persiste todos os equipamentos em
  `inspectedEquipments`, preservando o principal para retrocompatibilidade.
- Platform e Operator usam o mesmo `PhotoInput` com múltiplas imagens, legenda, estados de upload,
  remoção/reordenação e revogação de object URLs. PMOC bloqueia conclusão abaixo de quatro fotos.
- Downloads de Documento e Orçamento consomem bytes via `api.blob()`; não há conversão Base64.

## PMOC UX-02 — Wizard profissional

- Wizard reorganizado em Identificação, Cobertura, Planejamento, Execução, Documento e Confirmação.
- Nome sugerido acompanha o cliente somente até a primeira edição manual; depois não é sobrescrito.
- Escopos são MultiSelect pesquisável alimentado por `PLAN_SCOPE`, com acesso ao CRUD oficial e
  atualização imediata da lista. Equipamentos e tipos de serviço continuam múltiplos.
- Planejamento mostra projeção das próximas datas; o detalhe permite editar cada request pendente
  preservando número, histórico e demais ocorrências.
- Resumo final permite voltar diretamente a qualquer seção e evidencia campos obrigatórios,
  opcionais, somente leitura e a política documental em linguagem de negócio.
- Runtime real confirmou criação, edição, OS, Assignment, Preview, PDF e repositório documental.

## PMOC Foundation — Bloco 3

- Dashboard PMOC possui oito indicadores reais, calendário mensal de Execution Requests e listas
  de próximas/últimas execuções consumidas do backend.
- Cards exibem saúde e progresso oficiais. O detalhe mostra contexto completo, ações rápidas,
  requests paginadas, documentos/OS navegáveis e timeline multiorigem append-only.
- Cliente e Equipamento exibem resumos PMOC baseados em `overview`; nenhum contador é derivado no
  navegador.
- Operator preserva o atendimento existente e mostra plano, execução, periodicidade, cliente,
  equipamentos, checklist, assinatura e documento relacionado.
- Nenhum calendário, documento, OS, Assignment ou estado PMOC paralelo foi criado.
- Lint e build de produção aprovados; imagem Docker reconstruída e smoke runtime de `/pmoc` e
  `/operator` aprovado com HTTP 200.

## PMOC Foundation — Bloco 2

- `/pmoc` é a gestão oficial de planos e usa wizard profissional de quatro etapas com dados reais.
- `/pmoc/:id` entrega resumo, métricas, solicitações, histórico e ações oficiais de gerar OS,
  reagendar, cancelar e atualizar defaults.
- A geração abre o `OperationCreationDrawer` reutilizável; não existe formulário ou Operation
  paralela. A Central de Relatórios encaminha PMOC para o módulo oficial.
- O Operator exibe contexto PMOC na fila e no atendimento, sem alterar Assignment ou autorização.
- Assinatura adapta a UX ao modo retornado pela configuração documental e não contém política local.
- Lint aprovado sem erros (um warning preexistente) e build de produção aprovado com 41 rotas;
  `/pmoc`, `/pmoc/:id`, `/operator` e saúde da API foram verificados no runtime Docker.

## PMOC Foundation — Bloco 1.1

- Tipos reconhecem identidade monotônica, Operation gerada, projeções e metadata do scheduler.
- `PmocHistoryItem.execution` concentra os dados necessários para a futura UX documental.
- Nenhum componente, rota, ação ou comportamento visível foi adicionado.
- O frontend continua sem autoridade para reservar número ou atualizar projeções.

## PMOC Foundation — Bloco 1

- O wizard gerencia cobertura, periodicidade completa, modo de geração, defaults e assinatura
  override usando APIs reais.
- A geração manual deixou de criar/vincular Operation diretamente em `/reports`.
- “Gerar Ordem de Serviço” carrega o prefill da Execution Request e abre o
  `OperationCreationDrawer` oficial; a confirmação retorna uma Operation/Assignment/OS normal.
- O avanço para conteúdo/preview PMOC é bloqueado até existir Operation oficialmente vinculada.
- Requests automáticas já geradas são reabertas pela Operation relacionada, sem duplicação.
- Lint aprovado sem erros (um warning preexistente) e build de produção aprovado com 40 rotas;
  a imagem Docker da Platform foi reconstruída com o wizard oficial atualizado.

## DC-03.1 — wizard enriquecido do Laudo Técnico

- O passo Conteúdo coleta Responsável Técnico e CREA/registro profissional.
- A Origem exibe um resumo somente leitura de razão social, documento, contato e endereço do
  solicitante selecionado.
- Cada equipamento recebe Tipo de Sistema, Local de Instalação e Situação Atual no seletor
  múltiplo oficial.
- O wizard valida os campos antes de persistir a Operation. Solicitante continua resolvido pelo
  backend e Preview/PDF permanecem no DocumentViewer oficial.

## DC-03 — Laudo Técnico

- A Central de Relatórios coleta conteúdo próprio do `TECHNICAL_OPINION`: objetivo, condições
  observadas, análise e conclusão.
- A seleção de equipamento único foi removida da Origem; equipamentos múltiplos são escolhidos no
  Conteúdo pelo seletor reutilizável e formam a tabela oficial.
- A etapa Evidências foi reduzida a Assinatura para esse tipo: não há checklist nem fotos.
- `DocumentViewer` continua sendo o único preview/render/download e passou a quebrar conteúdo de
  células em tabelas de largura fixa.
- Nenhuma rota ou endpoint novo foi criado.

## Work Order — QR textual

- O `DocumentViewer` recebe apenas metadata `Código QR` nas novas Ordens de Serviço.
- Não existe QR gráfico local ou espaço reservado; documentos históricos continuam compatíveis.

## Refinamento TECHNICAL_REPORT — 14/07/2026

- `DocumentViewer` passou a espelhar o cabeçalho PDF em duas linhas: logo isolada, seguida por
  título/número e dados institucionais em colunas independentes.
- O Renderer PDF foi alinhado às proporções já aprovadas no Preview; nenhuma composição frontend
  adicional foi criada.
- A Central renomeou a seleção para `Equipamentos`; a composição e a ordem permanecem recebidas do
  Blueprint oficial, sem QR ou seções locais.

## Refinamento do cabeçalho documental

- `DocumentViewer` centraliza verticalmente a logo em relação ao bloco textual e não apresenta
  metadados técnicos no rodapé público.

## DC-02 — Relatório de Visita Técnica

- o workflow `TECHNICAL_REPORT` coleta objetivo, diagnóstico, atividades, recomendações e
  observações finais em campos autoritativos da Operation;
- `DocumentViewer` continua único e passou a respeitar `pageBreakAfter` e pesos de componentes para
  paginação coerente com o LayoutEngine;
- runtime Chrome confirmou `RVT-000015` em `/reports`, Preview com quatro páginas e os mesmos grupos
  do PDF oficial;
- não existe preview, PDF, QR ou política de assinatura local.

## Product Backlog Closure 07 — Central de Relatórios

- `/reports` virou a Central oficial com dashboard, histórico, filtros e wizard em quatro etapas.
- documentos com origem Operation podem reabrir o wizard para edição dos dados e novo render.
- `/report-templates` recebeu a biblioteca exclusivamente administrativa.
- `/reports/visita` redireciona para a Central; o fluxo duplicado foi removido.
- Financeiro foi movido para Gestão; Documentos permaneceu em Operação.
- Configurações não replica mais Templates/Document Configuration.
- Browser real confirmou menus, cinco cards, wizard e separação de responsabilidades.

## DC-01.2 — Preview/PDF parity

- o contrato reconhece a quebra preferencial de seção após Equipamento, preservando compatibilidade;
- `DocumentViewer` renderiza a imagem QR oficial do Blueprint, sem placeholder textual.
- tokens visuais do Blueprint alinham Preview e PDF para cores, tipografia e espaçamento.
- metadados, larguras de tabela, checklist e assinaturas foram aproximados do Renderer oficial.
- runtime real confirmou QR, assinatura técnica configurada e assinatura coletada no Preview 3/3.
- nenhuma rota ou fluxo documental paralelo foi criado.

## DC-01 — Work Order

- criação de Operation coleta defeito, serviços e observações separadamente;
- Operator envia notas de execução como `serviceDescription`;
- configurações da organização permitem endereço e website institucionais;
- DocumentViewer renderiza logo e informações institucionais do Blueprint.

## Document Engine D1

- `/documentos` consome `GET /documents`, sem mesclar Operations ou datasets locais.
- filtros, busca e paginação são server-side e cumulativos.
- drawer apresenta resumo, metadados e `DocumentViewer` para preview/render/download.
- templates suportam múltiplas assinaturas institucionais e políticas de execução.
- assinaturas suportam conselho profissional e departamento.
- BudgetDetailDrawer foi preservado por já consumir o Document Engine oficial.

## Product Backlog Closure 06.1 — visual runtime verification

Status: concluída em 11 de julho de 2026.

- `/operacoes` exibiu em Chrome real `Criado` e `Data do agendamento` com valores distintos.
- Drawer exibiu `Datas` e `Agendado para` sem fallback.
- DocumentViewer real exibiu assinatura na página 3/3.
- `Drawer` usa portal no `document.body`, corrigindo clipping de viewers aninhados.
- Script opt-in de inspeção visual registra screenshots temporários e evidência segura.

## Product Backlog Closure 06 — OS real e datas operacionais

Status: concluída em 11 de julho de 2026.

- Tabela de Operações separa “Criado” (`createdAt`) e “Data do agendamento” (`scheduledFor`).
- Drawer da Operation ganhou seção Datas e captura persistente de assinatura para a OS.
- Confirmação da assinatura aguarda backend e recarrega a fonte autoritativa.
- DocumentViewer identifica visualmente modelo versus preview com dados reais e pede render atual.
- Operator prioriza `scheduledFor`; ausência aparece como “Não agendado”, sem usar `assignedAt`.

Validação final: build passou; lint passou com 2 warnings pré-existentes (imports não utilizados em
`bottom-nav.tsx` e `sidebar.tsx`).

## Product Backlog Closure 05 — Reports visual refinement and document consistency

Status: concluída em 10 de julho de 2026.

Correções e refinamentos:

- `/reports` teve os cards de modelos refinados para layout mais compacto, com ações discretas e
  menos peso visual.
- O drawer explicita a diferença entre preview estrutural de modelo e preview com dados reais.
- Preview de modelo continua usando `DocumentViewer source={{ templateId }}`.
- Preview real/render/download continuam usando `DocumentViewer source={{ operationId, type }}`.
- Nenhum preview local, `DocumentPaper` ou fallback visual foi reintroduzido.
- O frontend passou a receber assinatura coletada da execução pelo mesmo `SignatureComponent` usado
  pelo PDF.
- Achado então pendente: `/reports/visita` era visual-only. Resolvido na Closure 05.1 abaixo.

Validação:

- `frontend npm run build`: passou.
- `frontend npm run lint`: passou com 2 warnings pré-existentes fora do escopo.

## Product Backlog Closure 05.1 — Platform Visit Report consolidated

Status: concluída em 10 de julho de 2026.

- `/reports/visita` deixou de ser visual-only.
- A rota agora seleciona uma Operation real e persiste evidências por `PATCH /operations/:id`.
- Checklist, observações, fotos e assinatura passam a pertencer à Operation.
- O preview usa `DocumentViewer source={{ operationId, type: "TECHNICAL_REPORT" }}`.
- Não há PDF local, object URL persistente ou modelo frontend paralelo.
- Fotos persistidas aparecem no `DocumentViewer` quando o backend resolve a imagem no blueprint.

Validação:

- `frontend npm run lint`: passou com 2 warnings pré-existentes.
- `frontend npm run build`: passou.

## Sprint 23 — V1 Product Completion & End-to-End Workflow Closure

Status: parcial/concluída em 10 de julho de 2026.

Sprint 23 não criou novos domínios nem contratos. O foco foi inspecionar os workflows V1 reais e
fechar continuidade crítica no Operator PWA.

Correções aplicadas:

- `/operator/services/[id]` deixou de exibir apenas cards estáticos de fluxo e passou a expor
  contexto operacional completo da Assignment/Operation:
  - cliente;
  - endereço;
  - equipamento;
  - tipo/status da Operation;
  - checklist oficial da Operation;
  - timeline/histórico da Assignment.
- O operador agora visualiza materiais consumidos pela Operation usando
  `GET /operations/:id/materials`.
- Quando a Assignment está `STARTED`, o operador pode registrar material via
  `POST /operations/:id/materials`, reutilizando Inventory oficial; saldo continua autoridade do
  backend.
- Documentos vinculados à Operation agora abrem o `DocumentViewer` oficial no Operator detail.
- O `DocumentViewer` deixou de exibir “placeholder” como versão e passa a usar o `version` do
  Blueprint.

Achados deferidos:

- Fotos e assinatura de campo continuam preservadas na Operation, mas coleta guiada completa no PWA
  fica para Sprint 24 como polish de experiência de campo.
- Offline sync continua fora da V1 e permanece como V1.1/Post-V1.

Validação:

- `frontend npm run lint`: passou com 2 warnings pré-existentes.
- `frontend npm run build`: passou.
- `backend npx prisma validate` com `DATABASE_URL` seguro: passou.
- `backend npm run lint`: passou.
- `backend npm run build`: passou.
- `backend npm test -- --silent`: 10 suites / 27 testes passaram.
- Suítes backend com PostgreSQL real não executaram porque não havia Postgres local em
  `127.0.0.1:5432`; não foram apontadas como regressão funcional.

## Sprint 21 — Performance, Load & Observability

Status: concluída em 6 de julho de 2026.

Sprint de verificação e documentação. Não criou telas nem fluxos novos.

Resultados do build Next.js 15/Turbopack:

- build passou;
- shared First Load JS: 139 kB;
- rotas Operator principais ficaram entre 142 kB e 153 kB de First Load JS;
- rotas administrativas mais pesadas identificadas:
  - `/equipamentos`: 449 kB;
  - `/budgets`: 336 kB;
  - `/produtos`: 330 kB;
  - `/financial`: 325 kB;
  - `/purchase-orders`: 324 kB.

Decisões:

- nenhum chunk foi extraído nesta sprint porque os cenários backend/API ficaram dentro do budget e a
  sprint não autorizava refatoração funcional ampla;
- `/equipamentos`, `/budgets` e `/produtos` ficam marcadas como candidatas a code splitting fino em
  Sprint 22/Post-V1 Optimization;
- manter paginação global e cancelamento de requisições em filtros/drawers para preservar os
  budgets backend medidos.

Baseline backend relevante para frontend:

- dashboard fan-out: p95 181.06 ms, error rate 0;
- Document Engine preview/render/download: p95 104.04 ms, error rate 0;
- Operator read path: p95 28.31 ms, error rate 0.

## Frontend Sprint 9 (Architecture Inspection, Navigation UX & Creation Flows)

Status: Concluída ✅ — 1 de julho de 2026. Next.js 15 · App Router · TypeScript. Navegação reorganizada e fluxos de criação consolidados sobre Operation real.

## Frontend Sprint 9 — Architecture Inspection, Navigation UX & Creation Flows

- Sidebar reorganizada:
  - Visão Geral: Dashboard, Agenda;
  - Operação: Operações, Serviços, Ordens de Serviço, Documentos;
  - Cadastros: Clientes, Equipamentos, Produtos;
  - Gestão: Relatórios, Financeiro, Usuários;
  - Sistema: Configurações, Perfil, Modo demo.
- Criados componentes reutilizáveis em `apps/platform/components`:
  - `CustomerSelect`;
  - `CustomerAddressSelect`;
  - `EquipmentSelect`;
  - `UserSelect`;
  - `DateTimePicker`;
  - `ServiceTypeSelect`;
  - `OperationCreationDrawer`.
- Fluxos de criação adicionados:
  - Agenda: **Novo agendamento** cria Operation agendada real;
  - Operações: **Nova operação** cria Operation real;
  - Serviços: **Novo serviço** usa o mesmo fluxo de Operation;
  - Ordens de Serviço: **Nova OS** cria Operation real e depende do backend para gerar OS rascunho.
- `OperationCreationDrawer` evita criar domínios paralelos: Agenda, Serviços e OS continuam usando Operation.
- RBAC visual aplicado com `<Gate>`:
  - Agenda usa `canSchedules`;
  - Operações/Serviços/OS usam OWNER/MANAGER/OPERATOR;
  - backend segue como autoridade final.
- Limitação documentada: o backend atual cria Operation com `operatorId = actor.id`; o seletor de operador fica preparado na UI, mas a delegação persistida depende de contrato backend futuro.

Validação:

- `npm run build` passou.

## Document Certification DC02B

Status: concluída em 13 de julho de 2026.

- `/reports` persiste competência, tipo de manutenção, checklists estruturados e equipamentos
  inspecionados para `TECHNICAL_REPORT`;
- equipamentos disponíveis são carregados pelo cliente selecionado;
- Configurações permite inscrição estadual e telefones adicionais;
- `DocumentViewer` renderiza o Corporate Header do Blueprint com fallback retrocompatível;
- Preview, render e download permanecem no Document Engine;
- lint passou com um warning preexistente e build de 39 rotas passou.
- Chrome headless confirmou o documento runtime na Central de Relatórios e cinco páginas/miniaturas
  no `DocumentViewer`.
- `npm run lint` passou com warnings pré-existentes de `<img>` e export anônimo.

## Frontend Sprint 8 — Inventory, Materials & Pricing Integration

- `@erp/api/inventory` criado para Products, Inventory Items, Stock Movements, Suppliers e Operation Materials.
- `@erp/api/pricing` criado para Pricing, stats, preço vigente e histórico.
- Tipos adicionados em `@erp/types`: `Product`, `InventoryItem`, `StockMovement`, `Supplier`, `OperationPart`, `ProductPricing`, `ResolvedProductPricing`, `InventoryStats` e `PricingStats`.
- `/produtos` deixou de usar `operationsApi.getProducts`/`demo.products.v1` e virou central real com abas:
  - Catálogo;
  - Estoque;
  - Fornecedores;
  - Preços;
  - Movimentos.
- `ProductFormDrawer` agora cria/edita produto via backend.
- Página de produtos exibe SKU, código interno, fabricante, marca, modelo, categoria, unidade, status, estoque associado e preço vigente quando permitido.
- Estoque exibe saldo atual, mínimo, ideal, reservado, disponível, localização, status crítico e histórico de movimentações.
- Fornecedores têm listagem, cadastro, edição, desativação, busca e paginação.
- Pricing exibe custo, reposição, custo médio, venda, mínimo, sugerido, margem, vigência e histórico; criação/revisão somente OWNER.
- `OperationDetailDrawer` ganhou seção **Materiais utilizados**, consumindo `GET /operations/:id/materials`, adicionando/removendo materiais por endpoints reais.
- Dashboard consome `/inventory/stats`, `/inventory/movements` e `/pricing/stats` para widgets reais.
- RBAC respeitado por `<Gate>` e por tratamento de 403 da API; backend continua autoridade final.

Validação:

- `npm run build` passou.
- `npm run lint` passou com warnings pré-existentes de `<img>` e export anônimo.

## Sprint 7 — Asset Lifecycle Integration

Status: Concluída ✅ — 30 de junho de 2026. Timelines oficiais agora consomem exclusivamente o Asset Lifecycle do backend.

## Backlog — Document Template Preview

Status: Concluído ✅ — 1 de julho de 2026.

- `DocumentViewer` passou a aceitar `source={{ templateId }}`.
- `@erp/api/documents` adicionou `previewTemplateDocument(templateId)`.
- `/reports` removeu a dependência de uma Operation real para preview de modelo.
- O drawer de preview mantém duas colunas, mas a coluna direita agora chama exclusivamente:
  - `GET /documents/templates/:templateId/preview`.
- Sem `DocumentPaper`, sem preview local, sem Demo Dataset e sem Operation fictícia.
- Templates inexistentes/inativos e erros de renderização são tratados pelo estado padrão de erro do `DocumentViewer`.

Validação:

- `npm run lint` passou com warnings pré-existentes de `<img>`/export anônimo fora do escopo.
- `npm run build` passou.

## Backlog — Paginação Global + Modelos de Relatórios

Status: Concluído ✅ — 1 de julho de 2026. Backlog frontend; posteriormente refinado pelo preview oficial de template do backend.

- `Pagination` virou o componente padrão para listagens da Platform: primeira, anterior, próxima, última, página atual, total, total de páginas e troca de tamanho de página.
- Listagens com backend paginado preservam filtros/ordenação ao trocar página/tamanho:
  - `/clientes`;
  - `/equipamentos`;
  - `/operacoes`;
  - `/usuarios`;
  - `/documentos` usando a paginação de `/operations`.
- Listagens ainda baseadas em dataset local/demo receberam paginação client-side com o mesmo componente, sem carregar todos os registros na tabela:
  - `/servicos`;
  - `/ordens`;
  - `/produtos`;
  - `/financial`.
- `/reports` foi refeito como **Modelos de Documentos**:
  - cards modernos e compactos;
  - badges de ativo/inativo, assinatura obrigatória, assinatura fixa/modo e template padrão;
  - ações principais reduzidas a **Visualizar** e **Configurar**;
  - botão **Novo Modelo** no cabeçalho usando o `TemplateFormDrawer` existente.
- Preview de modelo não usa `DocumentPaper` nem preview local. O drawer reutiliza `DocumentViewer` e consome o preview oficial do backend por `templateId`.
- `TemplateFormDrawer` preservado e evoluído apenas em UX, com foco automático no nome.
- Exclusão de modelo disponível por confirmação no drawer de preview, respeitando proteção de templates de sistema pelo backend.

Validação:

- `npm run lint` passou com warnings pré-existentes de `<img>`/export anônimo fora do escopo.
- `npm run build` passou.

## Sprint 7 — Asset Lifecycle Integration

- `@erp/api/asset-lifecycle` integrado aos endpoints oficiais:
  - `GET /equipments/:id/lifecycle`;
  - `GET /equipments/:id/lifecycle/stats`;
  - `GET /asset-lifecycle`;
  - `GET /asset-lifecycle/:id`.
- Tipos `AssetLifecycle*` adicionados em `@erp/types`.
- `AssetTimeline` criado em `@erp/ui/assets/asset-timeline.tsx`.
- Timelines locais removidas:
  - `@erp/ui/timeline` removido;
  - `operationsToTimeline` removido;
  - histórico local/demo em Cliente, Equipamento, Operator e OperationDetailDrawer substituído.
- Página `/equipamentos/[id]` ganhou abas:
  - Resumo;
  - Informações;
  - Timeline;
  - Documentos;
  - Métricas;
  - Anexos.
- `/clientes/[id]` passou a mostrar timeline consolidada via `GET /asset-lifecycle?customerId=...`.
- Drawers de Cliente e Equipamento usam `AssetTimeline`.
- Operator `/operator/equipamentos/[id]` usa o mesmo `AssetTimeline`.
- Eventos `DOCUMENT` abrem o `DocumentViewer` existente.
- Eventos com `operationId` abrem o `OperationDetailDrawer` existente.
- Dashboard passou a consumir `GET /asset-lifecycle` para widgets reais de ciclo de vida.

Validação:

- `npm run build` passou.
- `npm run lint` passou com warnings pré-existentes de imagem/useMemo fora do escopo.

## Sprint 6 — Document Center & Configuration Integration

- `@erp/api/documents` integrado aos endpoints oficiais:
  - `GET /documents/operations/:operationId/:type/preview`;
  - `POST /documents/operations/:operationId/:type/render`;
  - `GET /documents/:documentId/preview`;
  - `POST /documents/:documentId/render`;
  - `GET /documents/:documentId/download`;
  - `GET /documents/configuration`.
- `@erp/api/signatures` integrado ao domínio de assinaturas:
  - listagem, criação, edição, soft delete, upload e download.
- `/documentos` virou a Central Documental real: lista documentos vindos de `/operations`, sem `demo.documents.v1`, com filtros cumulativos por cliente, equipamento, operador, tipo, status e data.
- `DocumentViewer` foi substituído por um componente único do Document Engine: preview oficial, páginas, miniaturas, zoom, navegação, atualizar preview, renderizar e baixar PDF real.
- `OperationDetailDrawer` e Operator `/operator/documents` reutilizam o mesmo `DocumentViewer`.
- `/settings` ganhou:
  - seção **Documentos**, consumindo `/documents/configuration`;
  - seção **Assinaturas**, consumindo `/signatures`.
- `/reports` permanece como Gestão de Modelos, mas removeu preview com dados de exemplo e passou a exibir configuração real dos templates.
- `TemplateFormDrawer` passou a administrar `requiresSignature`, `signatureMode` e `signatureId`.
- Fluxos removidos: `DocumentPreview`, `DocumentDownload`, `GeneratedDocument`, download JSON/local, preview `DocumentPaper` para documentos emitidos e `operationsApi.getDocuments`.

Validação:

- `npm run lint` passou com warnings existentes de imagem/useMemo fora do escopo.
- `npm run build` passou.

Pendências conscientes:

- O backend ainda não aplica assinatura fixa/coletada no PDF; o frontend apenas persiste e exibe a configuração.
- Editor visual, workflow, aprovação, versionamento, ICP/DocuSign e assinatura eletrônica continuam fora do escopo.

## Sprint — Assignment Domain + Operator Workflow

Integração concluída:

- `packages/api/assignments.ts` criado para consumir `/assignments`;
- tipos `Assignment`, `AssignmentStatus`, `AssignmentHistoryItem` adicionados em `@erp/types`;
- `OperationCreationDrawer` envia `operatorId` e passa a criar Operation + Assignment automaticamente;
- `/agenda` da Platform passou a ser uma visão de calendário sobre Assignments reais;
- `OperationDetailDrawer` mostra responsável, status, histórico e permite reatribuição para
  OWNER/MANAGER;
- Operator Home passou a usar `/assignments/my`;
- `/operator/services` virou **Minhas ordens** reais;
- `/operator/agenda` mostra a agenda de campo por Assignments;
- `/operator/services/[id]` controla aceite, início, conclusão e recusa via backend.

Validação:

- `npm run build` passou;
- `npm run lint` passou com warnings antigos de `<img>` fora do escopo.

## Frontend Sprint 10 — Budget Integration

Integração concluída:

- `packages/api/budgets.ts` criado para consumir a API oficial de Budget;
- `@erp/types` expandido com `Budget`, `BudgetItem`, `BudgetApproval`, `BudgetHistory`,
  `BudgetStats`, `BudgetStatus` e payloads;
- `/budgets` criado como **Central Comercial**;
- Sidebar adicionou **Orçamentos** para `OWNER`/`MANAGER`;
- Dashboard (`/`) adicionou widgets reais de Budget via `GET /budgets/stats`;
- `OperationDetailDrawer` ganhou seção **Orçamentos** consumindo
  `GET /operations/:id/budgets` e criação vinculada à Operation.

Endpoints integrados:

- `GET /budgets`;
- `GET /budgets/:id`;
- `GET /operations/:id/budgets`;
- `POST /budgets`;
- `PATCH /budgets/:id/approve`;
- `PATCH /budgets/:id/reject`;
- `DELETE /budgets/:id`;
- `GET /budgets/stats`;
- `GET /budgets/history/:id`.

UX implementada:

- cards de métricas;
- tabela paginada;
- filtros cumulativos por busca, cliente, equipamento, status e período;
- `BudgetDetailDrawer` com resumo, itens, histórico, aprovação, documento e timeline;
- `BudgetCreationDrawer` consumindo Product/Pricing e enviando apenas itens para o backend;
- ações de aprovar, rejeitar e cancelar com confirmação;
- loading, skeleton, retry, empty states, badges e drawers responsivos.

Document Engine:

- preview do modelo `BUDGET` usa `DocumentViewer` com
  `GET /documents/configuration/types/BUDGET` + `GET /documents/templates/:templateId/preview`;
- render/download de PDF de orçamento emitido permanecem aguardando contrato backend específico de
  Budget Document. Nenhum preview local foi criado.

RBAC:

- UI exibe Budget para `OWNER`/`MANAGER`, alinhada ao backend da Sprint 14;
- `OPERATOR` não acessa o domínio comercial;
- backend continua sendo a autoridade final para 401/403.

Validação:

- `npm run lint` passou;
- `npm run build` passou.

## Backlog — Budget Document Emission

Integração concluída:

- `packages/api/budgets.ts` expõe `renderBudget` e `downloadBudget`;
- `/budgets` usa `BudgetDocumentPanel` no drawer de detalhe;
- "Emitir Documento" chama `POST /budgets/:id/render`;
- "Baixar PDF" chama `GET /budgets/:id/download`;
- `DocumentViewer` recebe `documentId` oficial, sem preview local;
- placeholder de documento futuro foi removido;
- `Budget.document` é usado para reabrir documento já emitido;
- Timeline reconhece o evento `DOCUMENT_RENDERED`.

UX:

- Budget `CANCELED`/`REJECTED` bloqueia emissão;
- documento ausente mostra empty state com CTA;
- erros de render/download aparecem no drawer;
- download converte `contentBase64` oficial em Blob PDF.

Validação:

- `npm run lint` passou com warnings pré-existentes de `<img>` e config;
- `npm run build` passou com os mesmos warnings pré-existentes.

## STAGE 0 — Branding

Identidade do cliente (Climatize) aplicada: `logo.PNG`/`favicon.PNG` copiados para `frontend/public/brand/` + `app/icon.png` (favicon) + `app/apple-icon.png` (iOS). Componente `@erp/ui/brand` (`BrandLogo`) usado no **login**, **sidebar** e **top bar do operador**. Tema azul/branco definitivo (Sprint 3); troca dinâmica de cores do OWNER preservada.

## STAGE 1 — Relatórios → Central documental (`/reports`)

A Platform administrava documentos por snapshot `demo.documents.v1` nesta etapa histórica; a Sprint 6 substituiu esse fluxo por `/operations` + Document Engine oficial.

## STAGE 2 — Serviços (`/servicos`) → Histórico operacional

Timeline do histórico: cliente, equipamento, operador, tipo, data, documentos e eventos (snapshot `demo.services.v1`). Drawer com `Timeline`. Sidebar: "Atendimentos" renomeado para "Serviços"; placeholder removido. Preparado para a futura Ordem de Serviço.

## STAGE 4 — Timeline reutilizável

`@erp/ui/timeline` (`Timeline` + `TimelineEvent`) com kinds instalação/manutenção/visita/documento/observação. Usado em **Serviço**, **Cliente** (`/clientes/[id]`) e **Equipamento** (`/equipamentos/[id]`), filtrando os serviços demo por cliente/equipamento.

## STAGE 3 — Operator refinado

Home com atalhos: Escanear QR · Agenda · Clientes · Equipamentos · Documentos · Sincronizar (+ CTA Novo Atendimento). Novas rotas: `/operator/equipamentos` (busca), `/operator/documents` (lista demo, somente leitura — nunca edita finalizados), `/operator/sync` (outbox offline-ready). Mobile-first mantido.

## STAGE 6 — Docker

`frontend/Dockerfile` (multi-stage, Next `output: standalone`) + `frontend/.dockerignore`. `docker-compose.yml`: serviço `frontend` (serve Platform `/` e Operator `/operator`; subdomínios via proxy em produção). `.env.example`: `FRONTEND_PORT`, `NEXT_PUBLIC_API_BASE_URL`, `NEXT_PUBLIC_ENABLE_DEMO`.

## STAGE 7 — RC1 Demo (`/demo-ready`)

Roteiro guiado de 8 passos (Dashboard → Cliente → Equipamento → Operator → Atendimento → Serviços → Documentos → Download) + contagens ao vivo + atalho "Abrir ERP Operador". Parece um fluxo único.

## Backend (aditivo)

Novos snapshots `demo.documents.v1` e `demo.services.v1` na factory (+ `DEMO_SETTING_KEYS`). Servidos dinamicamente pelo `/internal/demo/dataset`.

## Pendências para a 1.0

Domínios reais (Agenda, Serviços, Ordem de Serviço, Documentos) substituindo o Demo Dataset; geração real de PDF + assinatura embarcada; encoder de QR scannable + scanner de câmera; sync real do outbox + service worker (cache offline); ícones PNG multi-resolução; rodar `next build`/seed e `docker compose` no ambiente real (validado por `tsc`).

## Backlog #001 — Agenda (produção)

- `/agenda` reescrita como **calendário mensal** (grade de 6 semanas, segunda-first), com células de altura fixa — nenhum evento ultrapassa os limites; excedente vira "+N mais" (drawer do dia).
- Navegação completa: mês anterior/próximo, seletor de mês, seletor de ano, botão **Hoje**. Cada navegação **consulta o backend** via `financialApi.getScheduleRange(from, to)` (intervalo da grade visível).
- Eventos **clicáveis** → `AgendaEventDrawer` (lateral) com cliente, equipamento, operador, tipo, data/horário, status, observações e ações gated por RBAC (reagendar/editar — escopo futuro).
- UX: loading (skeleton nas células + spinner na toolbar), erro + retry, empty state ("Nenhum agendamento no mês"), transição suave entre meses (`animate-fade-in` por mês).
- Build de produção desbloqueado: `routes/` (preview TanStack legado) excluído do `tsconfig` (quebrava `next build`).

## Backlog #002 — QR Code operacional (produção)

- Scanner real de câmera (PWA) com `@zxing/browser` (apenas QR): `packages/ui/qr-scanner.tsx` — câmera traseira por padrão, troca de câmera, cancelar, loading, guia de enquadramento + linha de leitura (`animate-scanline`), e tratamento de permissão negada / câmera indisponível / QR inválido / equipamento inexistente.
- Botão "Escanear QR Code" no fluxo Novo Atendimento → Buscar Equipamento: lê o QR → `GET /equipments/lookup/:qrCode` → card do equipamento (nome, cliente, endereço, patrimônio, série, status, foto) → confirma → **pré-seleciona no wizard e avança** (sem nova busca).
- `/operator/qr` passou a usar o scanner real + `lookupByQr` (sem simulação).
- API: `equipmentsApi.lookupByQr(qrCode)`; backend `GET /equipments/lookup/:qrCode`.

## Backlog #003 — Relatórios, Documentos e Templates

- **Relatórios** (`/reports`) virou **Gestão de Modelos**: 7 modelos profissionais (OS, Relatório Técnico, Visita Técnica, PMOC, Laudo, Orçamento, Recibo) com identidade compartilhada (`@erp/ui/documents/document-paper` + `model-blueprints`). Ações por modelo: pré-visualizar, editar, ativar/desativar (`isActive`), definir padrão, importar (upload), versão (updatedAt) — consumindo `/organization/templates`.
- **Documentos** (`/documentos`) virou **Central Documental** histórica com snapshot; substituída na Sprint 6 por documentos reais de Operations, preview oficial e download PDF via backend.
- Backend: `DocumentTemplate.isActive` (migration + DTO + serviço). Sem novos Demo Datasets.

## Backlog #004 — Operações (OS + Formulários Base)

- Domínio **Operation** real consumido via `operationApi` (`@erp/api/operation`) — distinto do `operationsApi` (snapshots demo). Tipos em `@erp/types` (`Operation*`, `CreateOperationPayload`).
- **Operator**: o Wizard de atendimento passou a **criar uma Operation real** (`POST /operations`) ao finalizar — fotos convertidas para data URL, assinatura e checklist enviados; a OS rascunho é gerada no backend. Tela de sucesso: "Atendimento registrado com sucesso · OS #000001 criada". (substitui o outbox local).
- **Platform**: nova página `/operacoes` (lista real, filtros por status, paginação) + `OperationDetailDrawer` com Timeline + Checklist + Fotos + Observações + Assinatura + Documentos relacionados. Preview foi migrado na Sprint 6 para `DocumentViewer`.
- **Fundação reutilizável** `@erp/ui/operations`: `operation-sections` (modelo de seções), `operation-view` (renderers), `operation-shared` (labels/tones + `operationsToTimeline`). Todos os documentos reutilizam essa base (OperationForm → Sections → Renderers).
- **Histórico (Timeline)** automático em: drawer de Equipamento (aba Histórico), drawer de Cliente (aba Histórico) e detalhe de Equipamento no operator — derivado de `/operations` (sem duplicação).
- **Documentos** (`/documentos`): agora mescla os documentos reais das Operations (incluindo a **OS em rascunho**) com o snapshot demo, mantendo filtros/preview.

## Frontend Sprint 11 — Financial & Procurement Integration (Orbit V1)

Financial e Procurement foram integrados na Platform usando apenas APIs oficiais do backend.

Implementado:

- `packages/api/financial.ts` agora consome o domínio real `/financial/*`; o antigo bridge financeiro por Demo Dataset foi removido.
- `packages/api/procurement.ts` criado para `/purchase-orders`, itens, recebimentos, stats e histórico.
- `/financial` virou módulo real com dashboard financeiro, filtros, paginação, contas, categorias, lançamentos, pay/cancel e drawers reutilizáveis.
- `/purchase-orders` criado como central de Pedidos de Compra com métricas, filtros, paginação, detalhe, itens, envio, cancelamento e recebimento parcial/total.
- Sidebar reorganizada nos grupos Visão Geral, Operação, Cadastros, Financeiro, Compras, Gestão e Sistema; “Modo Demo” removido do menu.
- Dashboard principal passou a exibir widgets reais de Financial e Procurement.
- `/demo-ready` não depende mais do antigo bridge financeiro.
- Tipos compartilhados adicionados para `Financial*` e `Purchase*`.

Validação:

- `npm run lint` passou com warnings legados de `<img>` e `postcss.config.mjs`;
- `npm run build` passou.

Pendências para polish:

- Evoluir fornecedores para rota própria caso o produto decida separar de `/produtos`;
- aplicar tabelas responsivas/cards mobile em Financeiro e Compras;
- melhorar máscaras monetárias/CPF-CNPJ nos formulários;
- substituir warnings legados de `<img>` por `next/image`.

## Sprint 17 — Executive Dashboard & Operational Intelligence (Orbit V1)

O dashboard principal (`/`) foi transformado em centro executivo/operacional usando apenas contratos reais existentes.

Arquitetura da informação implementada:

1. Resumo executivo.
2. Centro de atenção.
3. Operação hoje.
4. Snapshot financeiro.
5. Ativos, manutenção e PMOC.
6. Estoque e compras.
7. Atividade relevante recente.

Fontes reais consumidas:

- Assignments: `/assignments`;
- Operations: `/operations/stats`;
- Financial: `/financial/stats`;
- Inventory: `/inventory/stats` e `/inventory/movements`;
- Procurement: `/purchase-orders/stats` e `/purchase-orders`;
- Maintenance Planning: `/maintenance-plans/stats` e `/maintenance-plans`;
- PMOC: `/pmoc/stats` e `/pmoc`;
- Asset Lifecycle: `/asset-lifecycle`.

Removido da home:

- `dashboardApi`;
- Demo Dataset;
- cards decorativos;
- métricas fake;
- valores hardcoded de negócio;
- feed local de agenda/financeiro.

Resiliência:

- cada seção possui loading/error/empty independente;
- falha em Financial não derruba Operações;
- falha em Procurement não derruba Maintenance/PMOC;
- consultas de atenção e atividade são bounded (`limit` pequeno) e sem leitura de listas completas.

RBAC:

- indicadores financeiros só são requisitados para `OWNER`/`MANAGER` com `canFinancial`;
- indicadores de compras são requisitados apenas para `OWNER`/`MANAGER`;
- o backend permanece autoridade final.

Validação:

- `npm run lint` passou com warnings legados;
- `npm run build` passou;
- não houve alteração backend nesta sprint.

Pendências para polish/hardening:

- criar endpoint agregado futuro se o volume real tornar o fan-out atual indesejado;
- adicionar filtros deep-link nas telas destino (`/financial`, `/produtos`, `/purchase-orders`, `/operacoes`);
- substituir os warnings legados de `<img>`;
- considerar testes frontend quando houver runner dedicado no pacote.

## Sprint 18 — Product UX Inspection, Frontend Consolidation & Polish

Inspeção sistemática executada em 38 rotas `page.tsx`:

- Platform: Dashboard, Agenda, Operações, Serviços, Ordens, Documentos, Budgets, Clientes, Equipamentos, Produtos/Estoque/Fornecedores/Pricing, Financeiro, Compras, Relatórios/Templates, Usuários, Settings, Profile e rotas legadas.
- Operator PWA: Home, Agenda, Minhas Ordens, Detalhe da Assignment, Clientes, Equipamentos, Documentos, QR, Sync, Profile, Login, Troca de Senha e Wizard de Atendimento.

Classificação:

- P0: 0 encontrados.
- P1: 4 encontrados / 4 corrigidos.
  - rotas legadas de Serviços e Ordens ainda serviam Demo Dataset;
  - rota Demo Ready ainda acessível com dados demo;
  - rotas detalhe placeholder de Produto/OS;
  - navegação duplicada para fluxos que hoje pertencem a Operações.
- P2: 7 encontrados / 7 corrigidos.
  - warnings legados de `next/image`;
  - warning de PostCSS anonymous export;
  - deep-links do dashboard sem filtros suportados;
  - Produtos não inicializava `tab` por querystring;
  - Financeiro não inicializava filtros por querystring;
  - Compras não inicializava status por querystring;
  - Operações não inicializava status por querystring.
- P3: 4 encontrados / 2 corrigidos / 2 deferidos.
  - labels/navegação refinados na sidebar;
  - rotas stale redirecionam com segurança;
  - bundle report da home será analisado em Sprint 21;
  - brand/document images mantidos com `<img>` por razão técnica.

Correções:

- `/servicos`, `/ordens`, `/ordens/[id]`, `/produtos/[id]` e `/demo-ready` agora redirecionam para fluxos reais, sem dead UI.
- Sidebar removeu destinos duplicados de Serviços/Ordens; Operações é a fonte operacional V1.
- Dashboard usa deep-links para `?status=`, `?type=` e `?tab=`.
- `/financial`, `/purchase-orders`, `/produtos` e `/operacoes` inicializam filtros suportados via URL.
- Warnings de imagem corrigidos com `next/image` em Profile, User Detail, Settings, Visita Técnica e PhotoInput.
- `postcss.config.mjs` corrigido para export nomeado.

Validação:

- `npm run lint` passou sem warnings;
- `npm run build` passou;
- `git diff --check` passou.

Decisões:

- Suppliers continua dentro de `/produtos?tab=suppliers`; a aba já possui fluxo completo e rota própria geraria duplicação neste momento.
- `<img>` permanece em BrandLogo e renderizadores documentais/base64 onde o optimizer do Next não é adequado.
- Frontend ainda não possui test runner configurado; item movido para certificação.

## Sprint 20.5 — Frontend AppSec Closure

Status: concluída em 5 de julho de 2026.

Correções frontend:

- `frontend/app/(platform)/reports/visita/page.tsx` passou a revogar object URLs criados para previews locais de fotos ao remover cada item e no unmount da página.
- `frontend/packages/types/index.ts` alinhou `AssetLifecycleEvent` ao contrato público sanitizado do backend: performer não expõe e-mail e anexos não expõem campos internos.

Decisões:

- timelines continuam consumindo `AssetLifecycle.timeline` como fonte oficial;
- frontend não deve depender de `metadata` bruto, `storageKey`, `eventId` ou `deletedAt`;
- downloads e ações em anexos continuam exclusivamente por endpoints autorizados.

## Sprint 22 — Production Readiness frontend notes

Status: validado em 6 de julho de 2026 dentro do gate RC local.

Alterações frontend:

- `packages/api/client.ts` passou a tratar `NEXT_PUBLIC_API_BASE_URL` relativo, permitindo `/api/v1`
  atrás de reverse proxy same-origin;
- `NEXT_PUBLIC_ENABLE_DEMO` passou a defaultar para `false`;
- `.env.example` do frontend passou a documentar demo bridge como opt-in;
- smoke de release valida rotas principais Platform e Operator contra build real.

Validações:

- `npm run build` passou;
- `npm run lint` passou;
- `npm run release:smoke:frontend` passou contra frontend em `127.0.0.1:4000` e API em
  `127.0.0.1:3001`.

Observação operacional:

- o pacote Next alerta que `next start` não é o modo ideal para `output: standalone`; o Dockerfile de
  produção usa o servidor standalone gerado pelo build.

## Sprint 22.5 — External RC Closure frontend notes

Status: executado em 10 de julho de 2026.

Correções:

- adicionado override `postcss@8.5.16` para fechar advisory transitivo reportado via `next`;
- lockfile atualizado por `npm install`.

Validação:

- `npm audit --json`: 0 vulnerabilidades;
- `npm run lint`: passou com 2 warnings existentes;
- `npm run build`: passou.

Decisão operacional:

- frontend V1 continua assumindo um backend isolado por instalação/cliente;
- deployments same-origin devem usar `/api/v1`;
- Demo Dataset/bridge permanece opt-in e desabilitado por padrão.

RC externo:

- smoke HTTPS externo ainda não foi executado por ausência de ambiente externo.

## Product Backlog Closure 01 — Product Registration, Pricing Entry Point, Customer Address and Reports Preview

Status: concluído em 10 de julho de 2026.

Correções aplicadas:

- cadastro de produto reorganizado em seções profissionais: identificação, classificação técnica, fornecedor contextual e descrição;
- categoria passou a usar sugestões reais derivadas do catálogo carregado, mantendo `category` como string do backend;
- SKU e código interno passaram a ter UX de sugestão/entrada controlada, preservando unicidade no backend;
- fornecedor não foi vinculado diretamente ao produto, pois o domínio real associa fornecedores via Procurement/Purchase Orders;
- CTA superior “Novo preço” foi removido; criação/revisão de preço fica na aba Preços e continua usando Pricing Domain;
- criação de cliente passou a permitir endereço inicial via endpoint oficial `/customers/:id/addresses`;
- falha ao salvar endereço não duplica cliente em retry;
- consulta de CEP foi adicionada como adaptador isolado ViaCEP, sem impedir edição manual;
- criação de equipamento agora deixa explícito quando o cliente selecionado não possui endereços;
- drawer de preview de Modelos de Documentos passou para layout vertical com preview legível e metadados menos duplicados.

Validação:

- `npm run lint` passou com 2 warnings preexistentes;
- `npm run build` passou;
- `git diff --check` passou antes da documentação.

## Product Backlog Closure 01.1 — Product Form, Supplier Resolution and Pricing Flow Fix

Status: concluído em 10 de julho de 2026.

Correções aplicadas:

- `ProductFormDrawer` substituiu categoria livre/datalist por select visível com categorias oficiais
  e opção `Outros` com campo obrigatório de categoria customizada;
- edição restaura categoria conhecida como opção selecionada e categoria desconhecida como `Outros`
  preenchido;
- SKU e código interno usam entrada assistida com prefixos técnicos e referências existentes sem
  remover a validação de unicidade do backend;
- fornecedores ativos são carregados de `GET /suppliers?page=1&limit=100&active=true` dentro do fluxo
  do formulário de produto;
- falha ao carregar fornecedores aparece como erro com retry, não como estado vazio;
- criação de fornecedor reaproveita o `SupplierDrawer` oficial, atualiza opções e auto-seleciona o
  fornecedor recém-criado quando o formulário de produto está aberto;
- produto envia `primarySupplierId` para persistência real no backend;
- aba Pricing abre sempre o `PricingDrawer` oficial para OWNER e o drawer trata loading/erro/estado
  vazio de produtos;
- fluxo de criação/revisão de preço mantém `pricingApi.createProductPricing` e
  `pricingApi.revisePricing`.

Validação:

- frontend `npm run lint` passou com 2 warnings preexistentes;
- frontend `npm run build` passou;
- backend `npm run lint`, `npm run build` e `npm test` passaram;
- Prisma `validate` e `generate` passaram com `DATABASE_URL` local.

## Product Backlog Closure 03 — PDF Exports and Signature UX

Status: concluído em 10 de julho de 2026.

Correções aplicadas:

- `ExportButton` agora possui ação PDF real via backend, com pending state, erro e download Blob;
- `/operacoes`, `/documentos` e `/equipamentos` passam filtros ativos para endpoints PDF;
- Settings/Assinaturas foi redesenhado com Drawer lateral claro para criação/edição;
- assinatura suporta dois modos explícitos: upload de imagem e desenho freehand;
- desenho freehand usa canvas pointer/touch/mouse, valida traço vazio, gera PNG transparente e envia
  pelo endpoint oficial `POST /signatures/:id/upload`;
- listagem de assinaturas usa `hasImage`, nunca `imageStorageKey`;
- assinaturas inativas permanecem visíveis; deletadas deixam de aparecer porque o backend filtra
  `deletedAt=null`.

## Product Backlog Closure 02 — Reports real preview/render/download

Status: concluído em 10 de julho de 2026.

Alterações frontend:

- `/reports` passou a selecionar uma Operation real para preview/emissão/download por tipo documental.
- `TemplatePreviewDrawer` preserva layout vertical, mas agora prioriza:
  - identidade do relatório;
  - resumo compacto;
  - fonte real do preview;
  - `DocumentViewer` oficial em área ampla.
- `DocumentViewer` passou a renderizar componentes `signature` do blueprint oficial.
- `/documentos` permanece como central/histórico dos documentos emitidos.

Validação:

- `npm run lint` passou com 2 warnings preexistentes;
- `npm run build` passou.

## Product Backlog Closure 04 — Avatar e Notifications

- `/profile` agora usa crop/reposition antes do upload de avatar;
- avatar final enviado ao backend é PNG 512×512;
- shell/topbar usa componente compartilhado de avatar e reflete `avatarAssetId` da sessão;
- Notification Bell da Platform consome endpoints reais;
- Notification Bell do Operator consome unread/list/read-all reais;
- não há estado local fake de notificações.

## Document Semantics Closure — explicit preview modes and Laudo type

Status: concluído em 10 de julho de 2026.

Alterações frontend:

- `/reports` passou a exibir dois caminhos distintos nos cards:
  - “Visualizar modelo”;
  - “Pré-visualizar com dados reais”.
- Model preview usa `templateId`, não exige Operation e não mostra render/download.
- Real data preview usa `operationId + type` e mantém render/download oficiais.
- `DocumentTemplateType` frontend recebeu `TECHNICAL_OPINION`.
- `DOCUMENT_KIND_LABEL` diferencia:
  - `TECHNICAL_REPORT`: Relatório de Visita Técnica;
  - `TECHNICAL_OPINION`: Laudo Técnico;
  - `REPORT`: Relatório legado.
- `/documentos` passa a filtrar/exibir `TECHNICAL_OPINION`.

Validação:

- `npm run lint` passou com 2 warnings preexistentes;
- `npm run build` passou.

# Closure — Technical Report Creation UX (2026-07-14)

- Central de Relatórios now selects Technical Report equipment only in Content through a searchable multi-select; Origin no longer exposes the ambiguous single-equipment field.
- Weekly/semiannual free-text syntax was replaced with the persistent checklist catalog, structured execution toggles, and per-item observations.
- Added `/maintenance-checklists` for catalog management and inline creation for OWNER/MANAGER.
- Technical Report image upload was removed from the workflow; PMOC keeps the existing secure image flow.

# Work Order wizard closure — 14/07/2026

- O wizard da Central permite escolher Operation existente ou criar a OS do zero.
- O modo novo coleta cliente/responsável na origem e múltiplos equipamentos, solicitação,
  execução/checklist e observações no conteúdo.
- Evidências fotográficas são opcionais e a assinatura continua obedecendo ao template.
- O DocumentViewer suporta a galeria oficial de duas colunas recebida no Blueprint.

## Product Backlog Closure 08 — Catálogos Técnicos (2026-07-15)

Status: concluído.

- O menu Cadastro foi renomeado de Checklists de Manutenção para Catálogos Técnicos, preservando a
  rota `/maintenance-checklists`.
- A página foi convertida em tabs dinâmicas para Checklist, Objetivos, Condições Observadas,
  Conclusões e Recomendações, todas consumindo a API oficial.
- CRUD, busca, paginação, status, ordenação manual, ativação/desativação e exclusão lógica usam
  `technicalCatalogsApi`; OWNER/MANAGER editam e VIEWER permanece em leitura.
- Criados `TechnicalCatalogSelector` e `TechnicalCatalogList`, compartilhados entre Platform e
  Operator, com `Outros`, edição de item personalizado, remoção e reordenação.
- O wizard Platform do Laudo seleciona responsável entre assinaturas institucionais ativas, completa
  nome/registro e mantém edição textual avançada após os seletores.
- O Operator suporta múltiplos equipamentos em checkboxes e seletores compactos para objetivos,
  condições, recomendações e conclusões.
- O frontend persiste somente snapshots textuais na Operation; Preview/PDF continuam exclusivamente
  no Document Engine.

## Closure 08.1 — Technical Catalog Classification

- CRUD ganhou tags e seletores múltiplos de área/workflow, além de filtros server-side.
- `TechnicalCatalogSelector` recebe contexto, pesquisa no backend e inclui `GENERAL`, sem ocultar
  valores históricos.
- Laudo e Visita na Platform inferem áreas pelos equipamentos; Operator reutiliza a mesma base.
- Nenhum conteúdo documental, Preview/PDF ou snapshot foi remodelado.

## DC-04 — PMOC

- O wizard da Central de Relatórios usa o plano real, múltiplos equipamentos, checklist por ativo,
  resultado Sim/Não/N.A., fotos e identificação do cliente signatário.
- O detalhe da Assignment no Operator reconhece execuções PMOC e permite preenchimento em campo.
- Preview, Render e Download permanecem no DocumentViewer; não há PDF ou preview local.

## Laudo Técnico — Objetivo e Conclusão (2026-07-15)

- O wizard separa o esclarecimento técnico livre das escolhas predefinidas.
- O texto livre é obrigatório e principal; escolhas aparecem como lista complementar no documento.
- Edição de laudos preserva os arrays retornados pela Operation, sem concatená-los ao parecer.

## PMOC — criação e gestão pelo wizard (2026-07-16)

- O passo Origem possui os fluxos `Criar novo PMOC` e `Selecionar PMOC existente`.
- OWNER/MANAGER criam, ajustam, ativam/desativam e removem logicamente o plano sem sair do wizard.
- O PMOC recebe número próprio; nenhuma OS é usada como origem.
- Ao continuar a emissão, uma Operation/OS oficial é criada e vinculada à execução planejada do
  PMOC, permanecendo disponível nos fluxos operacionais normais.

## PMOC UX-01 — 2026-07-16

- O wizard usa `MultiSelect` para equipamentos ativos do cliente e múltiplos `OperationType`.
- A etapa de assinatura segue o Template: `NONE`, `FIXED`, `COLLECTED` ou `HYBRID`.
- A assinatura institucional é somente leitura; “Alterar assinatura somente deste PMOC” persiste
  `signatureOverrideId` sem modificar o Template.
- O Operator consulta a mesma política e não exibe coleta em `NONE`/`FIXED`.
- Platform, Agenda, Relatórios e Operator usam mensagens orientadas ao negócio.

## FIELD REPORT HANDOFF 01 — 2026-07-17

- `/operator/services/:id` ganhou coleta de relatório orientada a campo para OS, Visita, Laudo,
  Orçamento e PMOC, com múltiplos equipamentos, conteúdo, evidências, assinatura e envio. Não há
  Render/Download no Operator.
- `/reports` ganhou a caixa “Relatórios recebidos”, revisão pré-preenchida, conteúdo editável,
  galeria de evidências, assinatura do cliente real, seletor/prévia da assinatura técnica e Viewer
  oficial após READY.
- O wizard manual da Platform persiste no mesmo handoff, respeita a matriz de assinaturas e permite
  salvar PENDING ou finalizar READY sem remover fluxos anteriores.
- `/documentos` usa estado editorial e exibe revisão junto da versão.
- Runtime visual aprovado em Platform, Operator e repositório; screenshots registrados no relatório
  de release.

## PMOC FIX-01 — 2026-07-17

- `/pmoc/:id` exibe o documento da última execução com **Sem PDF**, **PDF disponível** ou **PDF
  desatualizado**, além de Pré-visualizar, Gerar/Gerar novamente e Baixar.
- O Drawer mantém apenas a ID da execução aberta e a resolve novamente após refetch, evitando perder
  o `documentId` criado durante o render.
- `DocumentViewer` compara fingerprints oficiais, usa metadados persistidos para tamanho/data e
  continua sendo o único fluxo de Preview/Render/Download.
- Runtime visual autenticado aprovado em build de produção.
# PMOC FIX-02A — Wizard de assinaturas (2026-07-17)

- O Wizard oficial ganhou modo de revisão para PMOCs existentes, aberto pela ação “Revisar assinaturas” no detalhe.
- A etapa exibe assinatura do cliente, coletor, data/hora, operador responsável e assinatura técnica.
- Coleta e substituição reutilizam `SignaturePad`; a escolha técnica reutiliza assinaturas ativas e aplica override somente ao PMOC.
- O `DocumentViewer` oficial é incorporado à etapa e recarregado após alterações.
- Política do template preservada: `NONE`, `FIXED`, `COLLECTED` e `HYBRID` controlam os blocos visíveis.

## PMOC FIX-02B — evidências fotográficas (2026-07-17)

- `/pmoc/:id` ganhou **Revisar evidências**, abrindo o mesmo `PmocPlanWizard` na etapa Evidências.
- Fotos existentes mostram miniatura protegida, legenda, autor, data/hora e ações de gestão.
- `PhotoInput` oficial suporta drag-and-drop, seleção múltipla, preview, legenda, progresso e grade 1/2/4 colunas.
- Adicionar, editar e remover recarregam Operation e `DocumentViewer`; nenhum preview ou uploader paralelo foi criado.

## Operator — atendimentos e relatórios autônomos (2026-07-18)

- Home e Meus Atendimentos possuem CTA para iniciar atividade sem atribuição.
- O Wizard oficial inicia OS, Relatório de Visita, Laudo ou Orçamento; PMOC assume uma execução pendente do plano oficial.
- O envio autônomo conclui o Assignment próprio e apresenta “rascunho aguardando aprovação”.
- Atendimentos delegados mantêm o tipo definido pela gestão e retornam como “Em revisão”.
- Nenhum dashboard administrativo, PDF local ou workflow paralelo foi introduzido no Operator.

## PMOC — navegação e gestão consolidada (2026-07-18)

- `/pmoc` foi reorganizado em duas tabs: **Visão geral** concentra indicadores e planos; **Agenda dos PMOCs** preserva o calendário e concentra próximas/últimas execuções.
- A agenda ganhou busca cumulativa por PMOC/cliente/equipamento e filtro de status, com badges explícitos em cada execução.
- O detalhe reutiliza o `PmocPlanWizard` em modo de edição completa para cobertura, planejamento, responsáveis e política documental.
- OWNER pode finalizar o PMOC mediante confirmação; o backend desativa o plano e preserva histórico, OS e documentos.
- Nenhum endpoint, calendário, scheduler ou domínio paralelo foi criado.

## Production-only data path (2026-07-18)

- Removidos o client `demo`, o agregador `dashboard` legado, `operationsApi` de snapshots e seus
  tipos `Demo*`.
- Removidos componentes sem consumidores baseados no antigo dataset e a rota `/demo-ready`.
- Docker/Next não recebem mais `NEXT_PUBLIC_ENABLE_DEMO`; o frontend possui somente
  `NEXT_PUBLIC_API_BASE_URL` para integração.
- Estados vazios agora representam respostas reais da API, sem registros locais de fallback.
## DC-06 — Orçamento certificado (2026-07-18)

- /budgets usa um único BudgetWizardDrawer para criação manual, criação pela OS concluída e edição pré-emissão.
- O fluxo antigo acoplado a Product/Pricing foi removido também do drawer da Operation.
- Serviços e materiais são listas dinâmicas independentes, reordenáveis e com subtotal imediato; o backend permanece autoridade dos totais.
- Wizard inclui valor por extenso editável, validade, formas de pagamento e assinaturas oficiais.
- A etapa de assinaturas mostra a imagem autenticada do responsável técnico e, ao editar, a assinatura do cliente já coletada com nome, data/hora e coletor; uma nova captura substitui somente o snapshot desse orçamento.
- Detalhe oferece Preview, emissão/reemissão, download e estado Sem PDF/PDF disponível/STALE pelo DocumentViewer.

## ORBIT_OPERATION_AUDIT_V1 — auditoria operacional (2026-07-18)

- A Platform e o Operator foram auditados sem alteração funcional; relatório completo em `docs/release/ORBIT_OPERATION_AUDIT_V1.md`.
- Veredito global: `ORBIT_OPERATION_AUDIT_V1_NOT_READY`.
- Gaps frontend prioritários: submissão Operator composta por chamadas não atômicas, caminho BUDGET baseado em Operation, filtros de Documentos derivados apenas da página atual, selects limitados a 100 registros e tela de sincronização legada sem flush real.
- Lint e build passaram; a certificação fica bloqueada pelos desvios de domínio, autorização, histórico e produção descritos no relatório.

## Fluxo de execução com revisão (Operator + Platform · 2026-07-19)

- **Status**: `OperationStatus` agora tem `PENDING` (Pendente) e `REVIEW` (Revisão) — labels/tones em `@erp/ui/operations/operation-shared`; filtros e deep-link `?status=` em `/operacoes`.
- **Operator**: "Iniciar atendimento" em uma ordem atribuída inicia a execução e navega para o **wizard de execução** (`/operator/execucao/[assignmentId]`, full-screen): Checklist → Coleta (documento/equipamentos/relato) → Fotos → Materiais → **Revisão do cliente** (visão geral organizada de tudo que foi feito + assinatura com aceite). Concluir envia handoff + completa o assignment → operação vai para **Revisão**. PMOC mantém o fluxo inline especializado.
- **Platform**: drawer da operação mostra "Aguardando aprovação" quando em `REVIEW`, com botão **Aprovar atendimento** (OWNER/MANAGER) → `PATCH /operations/:id/approve` → Concluída.
- API: `operationApi.approveOperation(id)`.

## Assinatura com identificação do signatário + revisão do fluxo self-service (2026-07-19)

- **Self-service em Revisão**: o atendimento iniciado pelo operador sem atribuição (OS, Laudo, Visita, Orçamento) já percorre o ciclo oficial (accept→start→complete) e termina com a operação em **Revisão**, aguardando o aprove do responsável; a tela de sucesso comunica isso.
- **Wizard de atendimento**: o passo de assinatura agora exige o **nome de quem assina** (+ função opcional); os dados vão para a Operation (`customerSignerName/Role`) e para o **registro oficial do handoff** (`collectCustomerSignature`) — usados pelo relatório final.
- **Identificação**: `buildOperationSections` inclui "Assinado por" (nome + função) quando a assinatura foi coletada; a seção "Assinatura do cliente" do `OperationView` mostra signatário e data.
- **Platform drawer (fix)**: `WorkOrderSignatureSection` deixou de exibir sempre o pad — com assinatura coletada mostra os dados do signatário, quem coletou e a **imagem da assinatura** (via handoff/`CustomerSignaturePreview`), com "Substituir assinatura" opcional; a coleta pela Platform também passou a exigir o nome do signatário.
- **Organização do drawer**: dados do atendimento primeiro (`OperationView`), depois assinatura/evidências, orçamentos, materiais e Timeline ao final.

## Revisão dos relatórios no drawer da operação (2026-07-19)

- Nova seção **"Revisão dos relatórios"** no drawer da operação (OWNER/MANAGER): para cada documento enviado, o responsável seleciona qual **assinatura do técnico responsável** (pré-definidas na plataforma, com imagem) vai para o relatório e clica em "Aplicar assinatura e finalizar" (`startHandoffReview → selectHandoffTechnicalSignature → finalizeHandoffReview`) — isso libera a geração do PDF na Central de Relatórios. Visível também em operações já concluídas com documentos pendentes (reparo de legado).
- Preview do documento (`DocumentViewer`): assinaturas em duas colunas (cliente à esquerda, técnico à direita).

## Ajustes de fluxo owner→operador + alertas no mobile (2026-07-19)

- **Status inicial correto**: operação criada pelo owner nasce `DRAFT` e a atribuição a leva a **Pendente** (backend); só o início da execução pelo operador muda para "Em andamento" (antes o drawer criava direto como IN_PROGRESS).
- **Assinatura no fluxo atribuído**: o wizard de execução passou a persistir a assinatura coletada também na **Operation** (`signatureData` + signatário + `signedAt`), além do handoff — o drawer da Platform passa a exibi-la igual ao fluxo self-service.
- **Alertas no operator**: `useAssignmentAlerts` (montado no `OperatorShell`) consulta as atribuições a cada 30s (e ao voltar o foco) e dispara **notificação local** (Notification API / service worker) quando chega um atendimento `ASSIGNED` ainda não visto; a home do operador também se auto-atualiza (30s + foco). Web Push real com o app fechado (VAPID) fica para uma etapa futura.

## Agenda do operador como calendário real (2026-07-19)

- `/operator/agenda` deixou de repetir a lista de atendimentos: agora é um **calendário mensal mobile** (inspirado na Agenda da Platform) — grade Seg–Dom com navegação de mês e "Hoje", dia atual destacado, **marcadores coloridos por status** em cada dia e seleção de dia por toque.
- Abaixo do calendário, a **lista cronológica do dia selecionado** (horário + cliente + equipamento + status, borda colorida por status) com link direto para o atendimento; seção "Sem data definida" lista atribuições ativas sem agendamento.

## Notificações organizadas + deep link (2026-07-19)

- `/operacoes?operationId=` abre o drawer da operação diretamente — o clique no sino agora leva ao item real, não só à listagem.
- `NotificationType` ganhou `ASSIGNMENT_REJECTED`.

## Compartilhamento de PDFs no app do operador (2026-07-19)

- `/operator/documents`: cada documento mostra a disponibilidade real — **"PDF disponível"** (renderizado), **"Em revisão"** ou **"Aguardando geração do PDF"**.
- PDFs disponíveis ganham ações **Compartilhar** (Web Share API com arquivo → share sheet nativo do dispositivo: WhatsApp, E-mail, Telegram…) e **Baixar** (download direto), na lista e no drawer de visualização. Navegador sem Web Share com arquivos cai para download com aviso.
- Documentos em revisão continuam visualizáveis (preview), com aviso claro e **sem** download/compartilhamento — o operador não gera PDF (a emissão exige aprovação do responsável na Platform; o backend já restringe `render` a OWNER/MANAGER e o `download` só serve PDFs emitidos e atualizados).
- Erros tratados: `DOCUMENT_STALE` (PDF desatualizado — pedir nova emissão) e `DOCUMENT_DOWNLOAD_NOT_READY`.

## Sessão que não cai mais ao voltar à página (2026-07-19)

- **Refresh proativo**: o AuthProvider renova o access token antes do vencimento (checagem a cada 60s com a página visível + imediatamente no `visibilitychange`/`focus`) via `ensureFreshSession()` — o retorno ao app não gera mais tempestade de 401/login.
- **Refresh serializado entre abas**: `refreshSession` usa Web Locks por escopo (`erp.session.refresh.<scope>`); ao entrar no lock, se outra aba já rotacionou (access token mudou no storage), reutiliza sem chamar o endpoint — elimina a corrida que revogava a sessão.
- Fluxo 401→refresh→replay e limpeza em erro fatal inalterados.

## Checklists reais de Catálogos Técnicos no wizard e no drawer (2026-07-19)

- Os "checks de atendimento" deixaram de ser mock: passam a vir de **Catálogos Técnicos** (`type: CHECKLIST`) filtrados pelo **workflow do documento** (WORK_ORDER/TECHNICAL_REPORT/TECHNICAL_OPINION/PMOC → mapeados por `technicalCatalogsApi.documentWorkflow`) + itens GERAIS, apenas ativos.
- **Operator (wizard de atendimento)**: o passo Checklist é semeado com os itens reais do catálogo para o documento em curso (`listChecklistItems`), com loading/vazio honestos; removido `defaultChecklist` de `service-types.ts` (agora só rótulos de tipo).
- **Platform (drawer de nova operação)**: o passo Checklist usa o `TechnicalCatalogSelector` (type CHECKLIST + workflow do documento) — o owner seleciona os checks cadastrados (e pode adicionar personalizados); removido o `DEFAULT_CHECKLIST` mock. Checklist passou a ser opcional.
- API: `technicalCatalogsApi.documentWorkflow(documentType)` e `technicalCatalogsApi.listChecklistItems(workflow, { maintenanceType? })`.

## ORBIT_DASHBOARD_V2_EXECUTIVE_OVERVIEW (2026-07-19)

- Dashboard da Platform reescrito para visão executiva, com menor carga visual (1 linha de KPIs + 2 linhas de 2 colunas, no lugar de ~7 seções):
  - **Resumo executivo**: 6 KPIs clicáveis — Operações em aberto (DRAFT+PENDING), Em andamento, Aguardando revisão, Finalizadas hoje (assignments COMPLETED com completedAt hoje), PMOCs pendentes (pmocStats.pendingExecutions), Recebimentos pendentes (contagem RECEIVABLE/PENDING; restrito por RBAC financeiro). Cada card linka para a página correspondente.
  - **Timeline operacional**: filtro Hoje (padrão) / Próximos 7 dias, scroll interno; cada item mostra horário, cliente, tipo, responsável, status e prioridade (derivada de agendamento/estado — apenas visual). Fonte: `assignmentsApi.listAssignments` por `operation.scheduledFor`.
  - **Saúde financeira**: um único gráfico de evolução (Receitas × Despesas × Saldo) a partir de `FinancialStats.monthlyFlow`; sem outras métricas financeiras. Gated (`canFinancial`).
  - **Comparativo operacional**: mês atual × anterior para Operações concluídas, Ordens de Serviço, PMOCs e Visitas Técnicas — contagens exatas via `documentsApi.listHandoffs({type,from,to})` (WORK_ORDER/TECHNICAL_REPORT/PMOC) + assignments concluídos por mês.
  - **Feed inteligente**: lista única (alertas + pendências + atividades recentes de `asset-lifecycle`), scroll interno, com marcador "preparado para IA" — estrutura `FeedItem` pronta para receber insights futuros.
- Sem novas regras/entidades/IA e sem alterações em Financeiro/PMOC/OS/Document Engine. Build, lint e typecheck aprovados.

## Dashboard V2 — reorganização (2026-07-19b)

- Layout final em 4 linhas: (1) Resumo executivo (6 KPIs clicáveis); (2) Comparativo operacional (barras mês atual × anterior) à esquerda + Saúde financeira (gráfico único Receitas×Despesas×Saldo) à direita; (3) **Cobertura de atividades** (gráfico radar/teia de aranha comparando mês atual × anterior por tipo de documento: OS, Visitas, Laudos, PMOC, Orçamentos, Recibos) à esquerda com width menor + **Atividades relevantes e recentes** (asset-lifecycle) à direita com width maior — substitui o antigo "feed inteligente" (removido, junto do texto "preparado para IA"); (4) Timeline operacional (Hoje / 7 dias) à esquerda com width maior + **Carga por operador** à direita.
- Radar usa contagens exatas por período via `documentsApi.listHandoffs({type,from,to})`. Sem novas regras/entidades/IA. Build, lint e typecheck aprovados.
# Customer Workspace e Vendas — 2026-07-22

- `/clientes` agora navega para a página dedicada; drawer somente para criar/editar.
- `/clientes/:id` possui abas Visão geral, Equipamentos, Serviços e Vendas, todas com API real e paginação.
- A listagem independente `/equipamentos` redireciona para Clientes; detalhes individuais permanecem compatíveis.
- Criado fluxo de venda por cliente com produtos reais, snapshots do backend, garantia e integração do Recibo.
# Operator first access signature — 2026-07-22

- `/operator/trocar-senha` agora possui dois passos: senha definitiva e cadastro da assinatura técnica.
- O fluxo usa `SignaturePad`, dados profissionais e endpoint multipart real.
- Ao concluir, a sessão é encerrada e a assinatura fica disponível no catálogo institucional utilizado pelos relatórios.
# Produtos comprados e vendidos — 2026-07-22

- `/produtos` foi dividido em Produtos comprados e Produtos vendidos sobre o mesmo catálogo oficial.
- O cadastro e a edição permitem marcar o produto para compra, venda ou ambos.
- A aba Vendas de `/clientes/:id` lista somente produtos classificados para venda.
- Pedidos de compra e materiais operacionais listam somente produtos classificados para compra.
- Não há catálogo local, duplicação de produto ou inferência por estoque/preço.
# Cadastro simplificado de produtos — 2026-07-22

- Novos produtos recebem sugestões editáveis de SKU e código interno.
- OWNER pode informar custo unitário e valor de venda no cadastro; a persistência usa o Pricing Domain.
- Informações técnicas, fornecedor e descrição foram movidos para seções opcionais recolhidas.
- Conflitos de identificadores e erros comerciais conhecidos são apresentados em pt-BR.
# UX de estoque e correção da venda — 2026-07-22

- Drawer de estoque separa resumo de quantidades e configurações de reposição com nomenclatura orientada ao usuário.
- “Reservado” foi substituído visualmente por “Quantidade separada para atendimentos”, com explicação do impacto no disponível.
- Nova movimentação usa ações explícitas: adicionar, retirar ou devolver, com previsão do saldo resultante.
- Cliente > Vendas lista somente produtos ativos, vendáveis e com preço vigente na data selecionada, exibindo o valor no seletor.
- Estados de carregamento, indisponibilidade e erros conhecidos foram localizados em pt-BR.

# Paridade do Wizard de OS no Operator — 2026-07-22

- O atendimento autônomo agora segue Cliente/local → Escopo → Execução → Checklist → Conteúdo → Evidências → Assinatura → Confirmação.
- O atendimento atribuído segue Checklist → Conteúdo → Evidências → Materiais → Assinatura → Confirmação.
- Os campos da OS são idênticos aos da Platform: defeito/solicitação, serviços executados/checklist e observações/resultado operacional.
- Assinatura e nome do cliente/responsável são obrigatórios no mobile, com data/hora visíveis no resumo e persistidas pelo backend.
- O PDF oficial passou a renderizar data e hora da assinatura em linha dedicada, mantendo paridade com o Preview.

## Conferência do cliente e conclusão direta

- A etapa Assinatura do atendimento autônomo passou a exibir o resumo completo antes da captura, igual ao atendimento atribuído.
- O atendimento atribuído também mantém resumo e assinatura no mesmo passo; a tela seguinte apenas confirma o destino correto.
- OS e RVT mostram `Concluir e gerar PDF` e não usam linguagem de aprovação/revisão. Tipos especiais atribuídos preservam o fluxo editorial existente.
- O status na identificação da OS aparece em pt-BR no Preview e no PDF.

# Assinatura técnica própria no Operator — 2026-07-22

- `/operator/profile` ganhou “Minha assinatura técnica”, com desenho, cargo, profissão, conselho, registro e departamento.
- A assinatura oficial vinculada ao usuário é carregada e pré-selecionada no passo Assinatura da criação autônoma e da execução atribuída de OS/RVT.
- Sem assinatura própria configurada, o Wizard bloqueia conclusão e direciona às configurações.
- A seleção vale apenas para o documento atual; o PDF usa o snapshot oficial do handoff e não a assinatura principal da organização.
## Operator — checklist opcional na criação autônoma de OS (2026-07-22)

- O passo Checklist da Ordem de Serviço iniciada no mobile voltou a oferecer seleção múltipla dos itens predefinidos no Catálogo Técnico oficial.
- A etapa é opcional: nenhum item é incluído automaticamente.
- Somente os itens selecionados pelo operador são enviados à Operation, já com `done: true`, pois representam atividades realizadas durante a criação autônoma.
- A semântica da Platform foi preservada: checklists escolhidos pelo Owner para uma atribuição continuam pendentes para execução posterior pelo técnico.
## Catálogo dedicado do RVT (2026-07-23)

- Catálogos Técnicos possui a nova aba `Checklist do RVT`, isolada visual e funcionalmente do
  checklist operacional de OS/PMOC.
- A aba aceita somente periodicidades Semanal e Semestral e fixa o workflow
  `TECHNICAL_REPORT`.
- Platform, Operator autônomo e Operator atribuído consultam somente esse catálogo no RVT, sem
  itens `GENERAL` ou de OS/PMOC.
- Os 18 defaults vêm do backend e continuam totalmente editáveis, reordenáveis, desativáveis e
  removíveis.

# PMOC Detail — execução por equipamento (2026-07-27)

- Resumo ganhou lista simples paginada dos equipamentos cobertos.
- Execuções lista a cobertura por equipamento e apresenta último estado, OS e documento.
- O botão Executar abre wizard dedicado: Identificação, Escopo, Evidências e Confirmação.
- Evidências permitem câmera/upload e legenda, com máximo de seis e sem mínimo.
- A confirmação cria/conclui a OS e solicita Preview/PDF pelo Document Engine oficial.
- Timeline e ações documentais existentes foram preservadas.
# PMOC — execução mobile por equipamento (2026-07-27)

- A opção PMOC em Novo Atendimento, visível para OWNER, deixou de abrir o configurador de planos.
- O fluxo mobile lista planos ativos, depois equipamentos cobertos, e abre o mesmo
  `PmocEquipmentExecutionWizard` usado no detalhe PMOC da Platform.
- Cada atendimento conclui uma execução individual e encaminha ao estado final com ações
  “Compartilhar PDF” e “Baixar PDF”, usando download autenticado do Document Engine.
- Configurações > Assinaturas permite associar uma assinatura institucional a um OWNER; essa relação
  alimenta automaticamente o técnico padrão do Wizard PMOC.

# Correções de Recibo e Equipamentos do cliente — 2026-07-28

- Ao selecionar uma Ordem de Serviço concluída como origem, a Central de Relatórios usa a data
  local atual como data de emissão do novo Recibo. A data da OS não é mais copiada.
- Na aba Equipamentos do detalhe do cliente, a ação Editar deixou de herdar o link da linha.
  O clique abre somente o drawer de edição; clicar nos demais campos continua abrindo o detalhe
  do equipamento.
- Nenhum contrato de API, entidade ou migration foi alterado.

# Cancelamento de atendimento no Operator — 2026-08-02

- O botão “Cancelar atendimento” permanece visível antes da conclusão, inclusive após o início.
- O wizard coleta evidências e depois motivo, assinatura técnica própria e assinatura opcional do
  cliente; somente a confirmação final persiste a solicitação e gera o PDF oficial.
- O resumo do atendimento passou a mostrar telefone principal/secundário do cliente.
- Operações exibe “Cancelado pelo operador”, “Reagendado” e “Cancelamento aceito” conforme a
  projeção oficial. O drawer permite gerar relatório, reagendar e aprovar/finalizar.

## Refinamento da conclusão do cancelamento — 2026-08-02

- A confirmação usa o rótulo compacto “Confirmar cancelamento”, adequado à largura mobile.
- Após a emissão, o app não abre mais o visualizador automaticamente: apresenta a mesma experiência
  de conclusão dos atendimentos, com Compartilhar, Baixar, Documentos, Minhas ordens e Início.
- O status pendente na tabela da Platform foi compactado para “Cancelada · operador” e não quebra linha.
# Equipamentos coletados no atendimento e encerramento de drafts — 2026-08-03

- O wizard de execução atribuída detecta OS sem equipamento e permite selecionar ativos existentes
  ou cadastrar vários equipamentos encontrados em campo.
- Tipo, marca, modelo e capacidade são validados antes do avanço; os dados persistidos alimentam o
  resumo, Preview e PDF oficial.
- A Central de Relatórios desativa o autosave assim que o registro documental é materializado e
  limpa novamente o draft ao finalizar ou renderizar, impedindo sua reaparição após a conclusão.
- Identificadores locais do formulário possuem fallback para WebViews sem `crypto.randomUUID`, sem
  alterar os UUIDs persistidos pelo backend.

# OS avulsa com múltiplos equipamentos — 2026-08-03

- O cadastro de cliente novo no Operator deixou de possuir campos de equipamento único.
- O primeiro passo reutiliza `FieldEquipmentCollection`, aceita até 20 equipamentos e exige tipo,
  marca, modelo e capacidade em cada item.
- Todos os equipamentos são cadastrados de uma vez e seguem para resumo, Operation, Preview e PDF.

# RVT Planning — Platform e Operator (2026-08-03)

- `/rvt` centraliza configurações; `/rvt/[id]` exibe cobertura, equipamentos e execuções paginadas.
- A Central de Relatórios redireciona criação de RVT para configuração, sem emissão antecipada.
- Operator escolhe “RVT avulso” ou “RVT configurado”; ambos convergem no fluxo oficial de Operation/Assignment/Document Engine.
- Assinatura do cliente é opcional apenas no RVT; assinatura técnica configurada é preservada na execução.
- Corrigida a conclusão de execuções configuradas: o checklist é sanitizado para o contrato de escrita.
- A tabela de ocorrências mantém ações separadas para detalhes/atribuição e execução no wizard,
  inclusive depois que a Operation já foi preparada.

## Equipamentos em campo — formulário único (2026-08-03)

- O Operator não empilha mais formulários ao adicionar equipamentos durante um atendimento.
- Um único formulário confirma cada equipamento em “Adicionar equipamento” e limpa os campos.
- Equipamentos confirmados aparecem em lista compacta, numerada e removível antes da persistência.

## RVT — garantia de atribuição da execução (2026-08-03)

- OWNER/MANAGER podem assumir ou reatribuir qualquer ocorrência não concluída.
- “Executar RVT agora” utiliza a Assignment primária garantida pelo backend e abre o wizard oficial.
- Operations históricas sem Assignment são corrigidas pelo `prepare`, sem intervenção manual.

## RVT — detalhes e atribuição no contexto (2026-08-03)

- A ação de detalhes não redireciona mais para `/operacoes`; o drawer permanece sobre `/rvt/[id]`.
- O preparo idempotente garante a Assignment antes de abrir os detalhes, inclusive em registros antigos.
- OWNER/MANAGER selecionam o operador e confirmam a atribuição no próprio drawer.
- A ação `Executar RVT agora` na Platform abre o wizard em um drawer local de `/rvt/[id]`; não
  navega nem renderiza a interface do PWA em uma rota `/operator`.
- Checklist abre marcado; cadastro em campo aparece somente sem equipamentos configurados.
- Cabeçalho/progresso ficam fixos e apenas o conteúdo da etapa possui scroll.
- A assinatura configurada do responsável técnico é preservada; o operador principal permanece como
  Técnico em Campo. Auxiliares são somente acompanhamento no mobile.

## RVT — fechamento de execução (2026-08-03)

- Wizard exibe Semanal e Semestral; a seleção marca todos os itens do tipo escolhido e limpa o
  grupo complementar, que permanece visível e bloqueado.
- Conclusão direta no Operator reutiliza a tela documental oficial com compartilhar, baixar,
  Documentos, novo atendimento e início.
- Drawer de atribuição envia responsável e auxiliares na mesma confirmação e mostra feedback de
  sucesso após persistência.
- Preview/PDF do RVT agora distinguem número documental no título e número sequencial da execução
  no item `Número` da identificação, ambos fornecidos pelo Document Engine.

## Portal do Cliente — provisionamento em Usuários (2026-08-21)

O cadastro de cliente voltou a tratar exclusivamente os dados cadastrais. O Owner cria o acesso na
página `Gestão > Usuários`, escolhendo `Portal do cliente` e vinculando um cliente já existente.
Esse fluxo provisiona a identidade isolada `CustomerPortalAccount`, apresenta a senha temporária
forte uma única vez e mantém o login restrito a `/customer/login`.

## Landing — acesso ao Portal do Cliente (2026-08-21)

O CTA superior de WhatsApp ao lado de `Gestão` foi substituído por `Portal do cliente`, apontando
para `/customer/login`. A mesma ação foi incluída no menu responsivo; os canais comerciais de
WhatsApp existentes no corpo da landing permanecem disponíveis.
