import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Owner e gestor também atendem pelo app (é comum reatribuírem a operação para
 * si quando o técnico não pode ir). Rota do fluxo marcada apenas com
 * `@Roles(Role.OPERATOR)` derruba esse atendimento com 403 — foi o que
 * aconteceu em produção, e o `RoleGuard` barra antes de a regra de negócio
 * rodar (`assertOperationAccess` e `PermissionsGuard` já liberam quem não é
 * OPERATOR).
 *
 * Este teste varre TODOS os controllers e cobra a exclusão do owner de forma
 * explícita: quem tirar o owner de uma rota precisa justificar aqui.
 */
describe('rotas que excluem o owner', () => {
  /** Exceções deliberadas: a restrição é de negócio e existe também no serviço. */
  const ALLOWED_WITHOUT_OWNER = new Map<string, string>([
    [
      'operations.controller.ts:requestCancellation',
      'Owner e gestor cancelam direto, sem solicitar (regra repetida em operation-cancellations.service).',
    ],
  ]);

  function controllerFiles(dir: string): string[] {
    return readdirSync(dir).flatMap((entry) => {
      const path = join(dir, entry);
      if (statSync(path).isDirectory()) return controllerFiles(path);
      return path.endsWith('.controller.ts') ? [path] : [];
    });
  }

  it('nenhuma rota exige papel sem incluir OWNER, fora as exceções declaradas', () => {
    const offenders: string[] = [];
    for (const file of controllerFiles(join(__dirname, '..', 'src'))) {
      const source = readFileSync(file, 'utf8');
      const lines = source.split('\n');
      lines.forEach((line, index) => {
        const match = line.match(/@Roles\(([^)]*)\)/);
        if (!match || match[1].includes('Role.OWNER')) return;
        // Nome do método logo abaixo do decorador (pulando outros decoradores).
        const method = lines
          .slice(index + 1, index + 8)
          .map((next) => next.match(/^\s{2}(?:async\s+)?([A-Za-z0-9_]+)\s*\(/)?.[1])
          .find(Boolean);
        const key = `${file.split('/').pop()}:${method ?? '?'}`;
        if (!ALLOWED_WITHOUT_OWNER.has(key)) offenders.push(key);
      });
    }
    expect(offenders).toEqual([]);
  });

  it('as exceções declaradas continuam existindo (senão a lista está obsoleta)', () => {
    const source = readFileSync(
      join(__dirname, '..', 'src', 'modules', 'operations', 'operations.controller.ts'),
      'utf8',
    );
    expect(source).toContain('requestCancellation');
    expect(source).toMatch(/@Roles\(Role\.OPERATOR\)\s*\n\s*@RequirePermission\('canReports'\)\s*\n\s*@Post\(':id\/cancellation'\)/);
  });
});
