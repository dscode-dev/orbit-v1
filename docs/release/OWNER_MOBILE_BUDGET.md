# Orçamento no app do OWNER

No workspace `ERP_Operation`, o botão **Criar orçamento** fica em
`/operator/atendimento`, imediatamente abaixo de **Executar PMOC**.
Ele abre `/operator/orcamento`. O botão e a rota permitem somente `OWNER`.
As APIs existentes continuam bloqueando `OPERATOR`; os gestores preservam
o fluxo da plataforma web.

O mobile usa o próprio `BudgetWizardDrawer` em apresentação de página, com
as mesmas sete etapas: Origem, Dados gerais, Serviços, Materiais, Valores,
Condições e Responsável técnico. As opções de origem manual ou OS concluída,
os catálogos, os cálculos e as validações permanecem compartilhados.
Orçamento não exige assinatura do cliente.

Na última etapa, o OWNER pode salvar o rascunho ou salvar e aprovar.
A aprovação usa a decisão comercial já existente em `/budgets/:id/approve`;
o documento oficial é gerado em `/budgets/:id/render` e obtido em
`/budgets/:id/download`. As ações de baixar/compartilhar são habilitadas após
a aprovação, a geração e o carregamento do arquivo.

O arquivo é carregado antes do clique de compartilhar, preservando a ativação
do usuário exigida pela Web Share API. Quando o navegador não suporta arquivos
no compartilhamento nativo, o PDF é baixado para compartilhamento manual.
Cancelar a folha de compartilhamento não é tratado como falha.

Falhas após a criação preservam o ID do orçamento. Falhas de PDF após uma
aprovação permitem gerar novamente sem repetir a decisão. A decisão é relida
no servidor em cada tentativa, inclusive após perda de resposta da aprovação.

## Validação

- 4 testes do fluxo de aprovação e retomada no frontend.
- 5 testes HTTP com PostgreSQL isolado: origem manual e OS concluída, assinatura
  técnica, aprovação, PDF válido, bloqueio de operadores, acesso web do gestor,
  desconto inválido e orçamento vencido.
- TypeScript e lint aprovados; build de produção concluído.
- Chrome com largura de 390 px e build de produção: sete etapas, validações,
  rascunho, aprovação posterior, falha de assinatura sem duplicação, falha de
  render sem repetir aprovação, download, chamada de compartilhamento e alternativa
  de download, botão/rota bloqueados para operador e rota bloqueada para gestor.
  Nesse teste de interface, a API e o compartilhamento nativo são simulados;
  o teste HTTP separado valida a geração real do PDF.

Com o frontend de produção rodando localmente:

```sh
cd frontend
node --test test/operator-budget.test.mjs
ORBIT_RUNTIME_VERIFY=true ORBIT_RUNTIME_FRONTEND=http://127.0.0.1:3011 node test/runtime/verify-operator-budget-ui.mjs
```

O teste de interface usa Chrome instalado em `/Applications` e a porta de
depuração 9367. Ele intercepta as chamadas de API e não usa contas reais.
O teste HTTP segue `backend/test/jest-security.json` e exige `TEST_DATABASE_URL`
apontando para um banco isolado com nome terminado em `_test`.
