# Orçamentos: proposta pendente e cliente avulso

O botão **Criar orçamento**, abaixo de **Executar PMOC**, continua exclusivo
para OWNER em `/operator/atendimento`. O wizard em `/operator/orcamento`
compartilha as sete etapas com a plataforma web.

## Cliente avulso na web e no mobile

A origem permite cliente cadastrado, cliente avulso/não cadastrado ou OS concluída.
O cadastro avulso inclui pessoa física/jurídica, identificação, CPF/CNPJ opcional,
contato, observações e endereço opcional. Ele é criado na mesma transação do
orçamento, com `isProvisional=true`, `isActive=false` e `provisionalExpiresAt`
igual ao vencimento do orçamento. Alterar a validade atualiza essa data.

Até o aceite, o cliente fica restrito ao orçamento: não aparece na listagem ou
nas estatísticas de Clientes, não pode ser consultado/ativado pelo CRUD normal
nem usado para abrir uma operação. Cadastros comuns existentes são preservados.
CPF/CNPJ já registrados não geram outro cliente.

A aprovação do orçamento efetiva o cliente na mesma transação: remove a marca
provisória e sua validade, ativa o cadastro e mantém seus dados/endereço.
Recusar, cancelar ou deixar vencer mantém o cliente oculto. Os dados ligados ao
orçamento são preservados para o histórico e o documento, sem exclusão física.
Propostas vencidas não podem ser aprovadas.

## PDF sem aprovação automática

No mobile, **Salvar pendente** ou **Concluir e gerar proposta** salva o orçamento
como `PENDING`. A emissão e o download do PDF não alteram a decisão comercial nem
efetivam o cliente avulso. O compartilhamento usa arquivo já carregado; sem Web
Share com arquivos, o navegador baixa o PDF para compartilhar manualmente.

A ação separada **Confirmar aceite do cliente** abre uma confirmação explícita.
Somente **Sim, cliente aprovou** chama a aprovação. O documento é atualizado após
a decisão, pois inclui o status comercial. Um PDF anterior é marcado STALE para
impedir o download de uma proposta com a decisão antiga.

A URL passa a incluir `budgetId`, permitindo reabrir a proposta após sair/recarregar
para gerar PDF, editar dados pendentes ou confirmar o aceite depois. A plataforma
web preserva os papéis OWNER/MANAGER e sua ação de aprovação; o mobile permanece
exclusivo de OWNER. Uma resposta perdida de aprovação ou falha de PDF pode ser
retomada sem duplicar a decisão ou o cadastro.

## Migração e validação

Aplicar `20261028120000_provisional_budget_customers` antes de iniciar o novo backend.
A migração é aditiva; clientes existentes permanecem definitivos. Publicar backend
e frontend compatíveis e regenerar o Prisma Client no build.

Testes:

```sh
cd frontend
node --test test/operator-budget.test.mjs
ORBIT_RUNTIME_VERIFY=true ORBIT_RUNTIME_FRONTEND=http://127.0.0.1:3011 node test/runtime/verify-operator-budget-ui.mjs
```

O teste de interface usa Chrome em `/Applications`, porta de depuração 9367,
frontend local e API/compartilhamento simulados. Exercita cliente cadastrado,
cliente avulso no mobile/web, PDF pendente, retomada por URL, edição, confirmação
separada de aceite e restrições de acesso. A geração real de PDF, ocultação,
validade, aprovação e efetivação são testadas por HTTP com PostgreSQL isolado em
`backend/test/security/operator-budget.security.spec.ts`, usando `TEST_DATABASE_URL`
com banco terminado em `_test`. O teste de frontend também integra o CI.
