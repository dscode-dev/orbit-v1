"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Building2, Plus, Users } from "lucide-react";
import { PageHeader } from "@platform/components/page-header";
import { DataTable, type Column } from "@platform/components/data-table";
import { Pagination } from "@platform/components/pagination";
import { ExportButton } from "@platform/components/export-button";
import { FilterBar, FilterChip } from "@erp/ui/filter-bar";
import { StatusChip } from "@erp/ui/status-chip";
import { SkeletonList } from "@erp/ui/skeletons";
import { EmptyIllustration } from "@erp/ui/empty-illustration";
import { ErrorState } from "@erp/ui/states";
import { Gate } from "@erp/ui/auth/gate";
import { UserFormDrawer } from "@platform/components/user-form-drawer";
import { UserDetailDrawer } from "@platform/components/user-detail-drawer";
import {
  customerPortalApi,
  usersApi,
  useQuery,
  type CustomerPortalDirectoryAccount,
  type Role,
  type TeamUser,
} from "@erp/api";
import { useDebounce } from "@erp/utils";
import { initials } from "@erp/utils";
import { ROLE_LABEL, ROLE_TONE, ROLES } from "@platform/user-display";

type StatusFilter = "all" | "active" | "inactive";
type AccessView = "team" | "customers";

export default function UsuariosPage() {
  const router = useRouter();
  const [accessView, setAccessView] = useState<AccessView>("team");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(20);
  const [role, setRole] = useState<Role | "">("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const debounced = useDebounce(search, 300);

  const [detail, setDetail] = useState<TeamUser | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<TeamUser | null>(null);

  const list = useQuery(
    (signal) => usersApi.listUsers({ page, limit, search: debounced || undefined, signal }),
    [page, limit, debounced],
  );
  const portalList = useQuery(
    (signal) => customerPortalApi.listAccountDirectory({
      page,
      limit,
      search: debounced || undefined,
      status: statusFilter === "active" ? "ACTIVE" : statusFilter === "inactive" ? "INACTIVE" : undefined,
      signal,
    }),
    [page, limit, debounced, statusFilter],
  );

  // Role/status filters are applied client-side over the current page.
  const rows = useMemo(() => {
    let items = list.data?.items ?? [];
    if (role) items = items.filter((u) => u.role === role);
    if (statusFilter !== "all") items = items.filter((u) => (statusFilter === "active" ? u.isActive : !u.isActive));
    return items;
  }, [list.data, role, statusFilter]);

  const columns = useMemo<Column<TeamUser>[]>(
    () => [
      {
        key: "name",
        header: "Usuário",
        sortAccessor: (u) => u.name.toLowerCase(),
        cell: (u) => (
          <div className="flex items-center gap-3 min-w-0">
            <span className="h-8 w-8 rounded-full bg-[var(--color-accent)] grid place-items-center text-white text-[11px] font-semibold shrink-0">{initials(u.name)}</span>
            <div className="min-w-0">
              <div className="font-medium truncate">{u.name}</div>
              <div className="text-caption truncate">{u.email}</div>
            </div>
          </div>
        ),
      },
      { key: "role", header: "Papel", className: "w-[150px]", sortAccessor: (u) => u.role, cell: (u) => <StatusChip tone={ROLE_TONE[u.role]}>{ROLE_LABEL[u.role]}</StatusChip> },
      { key: "jobTitle", header: "Cargo", className: "w-[160px]", cell: (u) => <span className="text-sm">{u.jobTitle ?? "—"}</span> },
      { key: "status", header: "Status", className: "w-[130px]", sortAccessor: (u) => (u.isActive ? 1 : 0), cell: (u) => <StatusChip tone={u.isActive ? "success" : "neutral"} dot>{u.isActive ? "Ativo" : "Inativo"}</StatusChip> },
    ],
    [],
  );

  const portalColumns = useMemo<Column<CustomerPortalDirectoryAccount>[]>(
    () => [
      {
        key: "name",
        header: "Usuário",
        sortAccessor: (account) => account.name.toLowerCase(),
        cell: (account) => (
          <div className="flex min-w-0 items-center gap-3">
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[var(--color-primary)]/10 text-[11px] font-semibold text-[var(--color-primary)]">
              {initials(account.name)}
            </span>
            <div className="min-w-0">
              <div className="truncate font-medium">{account.name}</div>
              <div className="truncate text-caption">{account.email}</div>
            </div>
          </div>
        ),
      },
      {
        key: "customer",
        header: "Cliente vinculado",
        sortAccessor: (account) => account.customer.tradeName || account.customer.name,
        cell: (account) => (
          <div className="min-w-0">
            <div className="truncate text-sm font-medium">{account.customer.tradeName || account.customer.name}</div>
            <div className="truncate text-caption">{account.customer.cnpj ?? account.customer.cpf ?? "Documento não informado"}</div>
          </div>
        ),
      },
      {
        key: "access",
        header: "Acesso",
        className: "w-[170px]",
        cell: () => <StatusChip tone="info">Portal do cliente</StatusChip>,
      },
      {
        key: "lastLogin",
        header: "Último acesso",
        className: "w-[170px]",
        cell: (account) => (
          <span className="text-sm">
            {account.lastLoginAt ? new Date(account.lastLoginAt).toLocaleString("pt-BR") : "Nunca acessou"}
          </span>
        ),
      },
      {
        key: "status",
        header: "Status",
        className: "w-[130px]",
        sortAccessor: (account) => (account.isActive ? 1 : 0),
        cell: (account) => (
          <StatusChip tone={account.isActive ? "success" : "neutral"} dot>
            {account.isActive ? "Ativo" : "Inativo"}
          </StatusChip>
        ),
      },
    ],
    [],
  );

  function changeAccessView(next: AccessView) {
    setAccessView(next);
    setPage(1);
    setRole("");
  }

  return (
    <div className="space-y-6 max-w-[1400px]">
      <PageHeader
        eyebrow="Gestão"
        title="Usuários"
        description="Equipe interna e acessos isolados do Portal do Cliente."
        actions={
          <Gate roles={["OWNER"]}>
            <button onClick={() => { setEditing(null); setFormOpen(true); }} className="inline-flex items-center gap-2 rounded-[var(--radius-md)] bg-[var(--color-primary)] text-[var(--color-primary-foreground)] px-3 h-9 text-sm font-medium shadow-[var(--shadow-card)] hover:shadow-[var(--shadow-hover)]">
              <Plus className="h-4 w-4" /> Novo usuário
            </button>
          </Gate>
        }
      />

      <div className="inline-flex rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-card)] p-1 shadow-[var(--shadow-card)]">
        <button
          type="button"
          onClick={() => changeAccessView("team")}
          className={`inline-flex h-9 items-center gap-2 rounded-[var(--radius-md)] px-3 text-sm font-medium transition ${accessView === "team" ? "bg-[var(--color-primary)] text-[var(--color-primary-foreground)]" : "hover:bg-[var(--color-muted)]"}`}
        >
          <Users className="h-4 w-4" /> Equipe interna
        </button>
        <button
          type="button"
          onClick={() => changeAccessView("customers")}
          className={`inline-flex h-9 items-center gap-2 rounded-[var(--radius-md)] px-3 text-sm font-medium transition ${accessView === "customers" ? "bg-[var(--color-primary)] text-[var(--color-primary-foreground)]" : "hover:bg-[var(--color-muted)]"}`}
        >
          <Building2 className="h-4 w-4" /> Portal do cliente
        </button>
      </div>

      <FilterBar
        search={search}
        onSearch={(v) => { setSearch(v); setPage(1); }}
        searchPlaceholder={accessView === "team" ? "Buscar por nome, e-mail, usuário, telefone…" : "Buscar usuário, e-mail, telefone ou cliente…"}
        right={
          <ExportButton
            label="Exportar"
            fileName={accessView === "team" ? "usuarios-internos" : "usuarios-portal-cliente"}
            rows={accessView === "team"
              ? rows.map((u) => ({ nome: u.name, email: u.email, usuario: u.username, papel: ROLE_LABEL[u.role], cargo: u.jobTitle ?? "", ativo: u.isActive ? "sim" : "não" }))
              : (portalList.data?.items ?? []).map((account) => ({ nome: account.name, email: account.email, usuario: "", papel: "Portal do cliente", cargo: account.customer.tradeName || account.customer.name, ativo: account.isActive ? "sim" : "não" }))}
          />
        }
      >
        {accessView === "team" && <>
          <FilterChip active={role === ""} onClick={() => setRole("")}>Todos os papéis</FilterChip>
          {ROLES.map((r) => (
            <FilterChip key={r} active={role === r} onClick={() => setRole(r === role ? "" : r)}>{ROLE_LABEL[r]}</FilterChip>
          ))}
          <span className="mx-1 h-5 w-px bg-[var(--color-border)]" />
        </>}
        <FilterChip active={statusFilter === "all"} onClick={() => setStatusFilter("all")}>Todos</FilterChip>
        <FilterChip active={statusFilter === "active"} onClick={() => setStatusFilter("active")}>Ativos</FilterChip>
        <FilterChip active={statusFilter === "inactive"} onClick={() => setStatusFilter("inactive")}>Inativos</FilterChip>
      </FilterBar>

      {accessView === "team" ? list.loading && !list.data ? (
        <SkeletonList rows={6} />
      ) : list.error && !list.data ? (
        <ErrorState error={list.error} onRetry={list.refetch} />
      ) : rows.length === 0 ? (
        <EmptyIllustration
          icon={Users}
          title={debounced || role || statusFilter !== "all" ? "Nenhum usuário encontrado" : "Nenhum usuário"}
          description={debounced || role || statusFilter !== "all" ? "Ajuste a busca e os filtros." : "Cadastre o primeiro usuário da equipe."}
        />
      ) : (
        <div className="space-y-3">
          <DataTable columns={columns} rows={rows} onRowClick={(u) => setDetail(u)} />
          {list.data && (
            <Pagination
              pagination={list.data.pagination}
              onPageChange={setPage}
              onPageSizeChange={(next) => { setLimit(next); setPage(1); }}
            />
          )}
        </div>
      ) : portalList.loading && !portalList.data ? (
        <SkeletonList rows={6} />
      ) : portalList.error && !portalList.data ? (
        <ErrorState error={portalList.error} onRetry={portalList.refetch} />
      ) : portalList.data?.items.length === 0 ? (
        <EmptyIllustration
          icon={Building2}
          title="Nenhum acesso de cliente encontrado"
          description={debounced || statusFilter !== "all" ? "Ajuste a busca e os filtros." : "Crie o acesso pelo botão Novo usuário e selecione Portal do cliente."}
        />
      ) : (
        <div className="space-y-3">
          <DataTable
            columns={portalColumns}
            rows={portalList.data?.items ?? []}
            onRowClick={(account) => router.push(`/clientes/${account.customerId}`)}
          />
          {portalList.data && (
            <Pagination
              pagination={portalList.data.pagination}
              onPageChange={setPage}
              onPageSizeChange={(next) => { setLimit(next); setPage(1); }}
            />
          )}
        </div>
      )}

      <UserDetailDrawer
        user={detail}
        open={detail !== null}
        onClose={() => setDetail(null)}
        onChanged={() => { list.refetch(); }}
        onEdit={(u) => { setDetail(null); setEditing(u); setFormOpen(true); }}
      />
      <UserFormDrawer
        open={formOpen}
        onClose={() => setFormOpen(false)}
        onSaved={() => { void list.refetch(); void portalList.refetch(); }}
        user={editing}
      />
    </div>
  );
}
