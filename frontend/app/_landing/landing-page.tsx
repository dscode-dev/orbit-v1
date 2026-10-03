"use client";

/**
 * Landing page pública da Clima Certo Refrigeração (cartão de visita + canal de contato).
 *
 * Página única com navegação por âncoras (#servicos, #relatorios, #empresa,
 * #contato) e efeito de reveal ao rolar (IntersectionObserver + CSS — sem
 * dependências novas). Consome apenas o endpoint público
 * `GET /organization/public`, que expõe somente dados de vitrine e contato.
 *
 * O botão "Gestão" leva à tela de login da plataforma (/login).
 */
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  ArrowRight,
  Award,
  Building2,
  ClipboardCheck,
  FileSignature,
  Gauge,
  Instagram,
  Mail,
  MapPin,
  Menu,
  MessageCircle,
  Phone,
  Settings2,
  ShieldCheck,
  Snowflake,
  UserRound,
  Wind,
  Wrench,
  X,
} from "lucide-react";
import { BrandLogo } from "@erp/ui/brand";
import { WhatsAppLink } from "./whatsapp-link";
import { GOOGLE_ADS_ID, openCookiePreferences } from "./analytics";
import { organizationApi, type PublicCompanyContact, type PublicCompanyProfile } from "@erp/api";
import { PreventiveBenefitsSection } from "./preventive-carousel";
import { BRAND } from "../brand";

const WHATSAPP_MESSAGE =
  "Olá! Vim pelo site e gostaria de saber mais sobre os serviços de climatização e refrigeração.";

const NAV = [
  { href: "#servicos", label: "Serviços" },
  { href: "#resultados", label: "Resultados" },
  { href: "#empresa", label: "A empresa" },
  { href: "#relatorios", label: "Documentação" },
  { href: "#contato", label: "Contato" },
];

/**
 * Serviços exibidos como cards com foto (estilo comercial). As fotos reais ficam
 * em `public/servicos/*.webp` (otimizadas). Se um arquivo faltar, o card cai num
 * degradê com o ícone do serviço, sem quebrar o layout. `focus` é o
 * object-position do recorte 4:3: aponta para onde estão as pessoas na foto.
 */
const SERVICES = [
  {
    icon: Wind,
    title: "Instalação",
    request: {
      ask: "solicitar um orçamento de *instalação de ar-condicionado*.",
      fields: ["Tipo e capacidade do aparelho (BTUs)", "Já tenho o aparelho? (sim/não)", "Bairro/cidade"],
    },
    image: "/servicos/instalacao.webp",
    focus: "center 40%",
    text: "Instalação e troca de aparelhos seguindo as normas técnicas e as recomendações do fabricante, com acabamento limpo e teste de funcionamento na entrega.",
    cta: "Quero instalar",
  },
  {
    icon: ShieldCheck,
    title: "Manutenção Preventiva",
    request: {
      ask: "*agendar uma manutenção preventiva*.",
      fields: ["Quantidade de aparelhos", "Tipo (split, cassete, piso-teto…)", "Bairro/cidade"],
    },
    image: "/servicos/manutencao-preventiva.webp",
    focus: "30% 0%",
    text: "Limpeza, inspeção e ajustes programados para o equipamento gastar menos energia, durar mais e não parar quando você mais precisa.",
    cta: "Agendar preventiva",
  },
  {
    icon: Wrench,
    title: "Manutenção Corretiva",
    request: {
      ask: "solicitar uma *manutenção corretiva* — meu ar-condicionado está com problema.",
      fields: ["O que está acontecendo (não gela, pingando, desligando…)", "Marca/modelo (se souber)", "Bairro/cidade"],
    },
    image: "/servicos/manutencao-corretiva.webp",
    focus: "center 22%",
    text: "Aparelho pingando, sem gelar ou desligando sozinho? Diagnosticamos a causa e resolvemos com peças e procedimentos registrados.",
    cta: "Solicitar reparo",
  },
  {
    icon: ClipboardCheck,
    title: "PMOC",
    request: {
      ask: "informações sobre o *PMOC* (Plano de Manutenção, Operação e Controle).",
      fields: ["Tipo de estabelecimento", "Quantidade de aparelhos", "Bairro/cidade"],
    },
    image: "/servicos/pmoc.webp",
    focus: "center 42%",
    text: "Elaboração e execução do Plano de Manutenção, Operação e Controle exigido por lei, com relatórios que comprovam a conformidade do ambiente.",
    cta: "Regularizar meu PMOC",
  },
  {
    icon: Gauge,
    title: "Cálculo de Carga Térmica",
    request: {
      ask: "solicitar um *cálculo de carga térmica* para saber os BTUs ideais.",
      fields: ["Tipo de ambiente (quarto, sala, escritório…)", "Tamanho aproximado (m²)", "Bairro/cidade"],
    },
    image: "/servicos/calculo-carga-termica.webp",
    focus: "82% center",
    text: "Dimensionamento técnico dos BTUs certos para o seu espaço — nem aparelho fraco que não dá conta, nem potência sobrando na conta de luz.",
    cta: "Calcular meus BTUs",
  },
  {
    icon: Settings2,
    title: "Projetos",
    request: {
      ask: "conversar sobre um *projeto de climatização*.",
      fields: ["Tipo de imóvel (residencial, comercial, industrial)", "Quantidade de ambientes", "Bairro/cidade"],
    },
    image: "/servicos/projetos.webp",
    focus: "center 62%",
    text: "Projetos de climatização para residências, comércios e indústrias, pensados para o uso real de cada ambiente e assinados por responsável técnico.",
    cta: "Falar sobre um projeto",
  },
];

/**
 * Números de vitrine da seção "Resultados". Por ora são fixos (marketing): a base
 * da empresa ainda não tem histórico. Quando houver, devem vir do endpoint
 * público em vez de ficar aqui.
 */
const COMPANY_METRICS = [
  { icon: Wind, value: "+1.250", label: "Equipamentos instalados" },
  { icon: Wrench, value: "+2.000", label: "Atendimentos concluídos" },
  { icon: Building2, value: "+90", label: "Empresas atendidas" },
  { icon: Award, value: "+2 anos", label: "De mercado" },
];

/**
 * Clientes exibidos na esteira "Empresas que confiam no nosso trabalho".
 * Por ora estático (logos em `public/clientes/*.webp`, quadradas). No futuro
 * virá do banco, cadastrado pelo OWNER.
 */
const CLIENTS = [
  { name: "Beleza Cão & Gato", logo: "/clientes/beleza-cao-e-gato.webp" },
  { name: "IEADALPE", logo: "/clientes/ieadalpe.webp" },
  { name: "AmorSaúde", logo: "/clientes/amor-saude.webp" },
];

/**
 * Esteira automática das logos. Desligada: com poucos clientes ela precisa
 * repetir as mesmas logos para preencher a tela. Com a lista maior, basta
 * ligar aqui; desligada, as logos ficam fixas e centralizadas.
 */
const CLIENTS_MARQUEE = false;

/**
 * Quantas vezes a lista se repete em cada metade da esteira: com poucos
 * clientes, uma volta só não preenche a largura da tela e a emenda apareceria.
 */
const CLIENT_REPEAT = Math.max(2, Math.ceil(10 / CLIENTS.length));

const REPORTS = [
  {
    icon: ClipboardCheck,
    title: "PMOC",
    text: "Plano de Manutenção, Operação e Controle emitido, atualizado e consultado sem papel.",
  },
  {
    icon: FileSignature,
    title: "Relatório de Visita Técnica",
    text: "Tudo o que foi visto e feito em campo, com fotos e assinatura no momento do atendimento.",
  },
  {
    icon: ClipboardCheck,
    title: "Ordem de Serviço",
    text: "Escopo, execução e materiais registrados numa OS clara, fácil de conferir e de auditar.",
  },
];

/**
 * Mensagem pré-preenchida do WhatsApp ao clicar no botão de um serviço: já vem
 * como pedido, com as informações que o técnico precisa para responder rápido.
 * O *texto* fica em negrito no WhatsApp; o cliente só completa os campos.
 */
function serviceRequestMessage(company: string, request: { ask: string; fields: string[] }) {
  const fields = request.fields.map((field) => `• ${field}: `).join("\n");
  return `Olá! Vim pelo site da ${company} e gostaria de ${request.ask}\n\n${fields}`;
}

/**
 * Arte do topo do hero: "logo" (logomarca como marca-d'água) ou "split"
 * (evaporadora com a logo no painel). Ambas mantêm a neve e o layout centralizado.
 */
const HERO_ART: "logo" | "split" = "logo";

/**
 * Flocos de neve do hero. Valores fixos (não aleatórios) para o HTML do
 * servidor bater com o do cliente; cada floco cai com tamanho, velocidade,
 * atraso e deriva diferentes para não parecer um padrão.
 */
const SNOWFLAKES = [
  { left: 4, size: 14, duration: 13, delay: -2, drift: 24, opacity: 0.55 },
  { left: 11, size: 10, duration: 16, delay: -9, drift: -18, opacity: 0.4 },
  { left: 18, size: 18, duration: 11, delay: -5, drift: 30, opacity: 0.6 },
  { left: 25, size: 9, duration: 18, delay: -13, drift: -22, opacity: 0.35 },
  { left: 32, size: 13, duration: 14, delay: -1, drift: 18, opacity: 0.5 },
  { left: 39, size: 11, duration: 17, delay: -7, drift: -26, opacity: 0.4 },
  { left: 46, size: 16, duration: 12, delay: -11, drift: 22, opacity: 0.55 },
  { left: 53, size: 10, duration: 15, delay: -4, drift: -16, opacity: 0.4 },
  { left: 60, size: 14, duration: 13, delay: -8, drift: 26, opacity: 0.5 },
  { left: 67, size: 9, duration: 19, delay: -15, drift: -20, opacity: 0.35 },
  { left: 74, size: 17, duration: 12, delay: -3, drift: 20, opacity: 0.6 },
  { left: 81, size: 11, duration: 16, delay: -10, drift: -24, opacity: 0.45 },
  { left: 88, size: 13, duration: 14, delay: -6, drift: 18, opacity: 0.5 },
  { left: 95, size: 10, duration: 17, delay: -12, drift: -14, opacity: 0.4 },
  { left: 8, size: 8, duration: 20, delay: -17, drift: 12, opacity: 0.3 },
  { left: 57, size: 8, duration: 21, delay: -19, drift: -12, opacity: 0.3 },
  { left: 92, size: 15, duration: 13, delay: -14, drift: 16, opacity: 0.5 },
  { left: 35, size: 8, duration: 22, delay: -20, drift: 10, opacity: 0.3 },
];

/** Link do wa.me com mensagem pré-preenchida. */
function waLink(number: string, message: string) {
  return `https://wa.me/${number}?text=${encodeURIComponent(message)}`;
}

function telLink(phone: string) {
  return `tel:${phone.replace(/[^\d+]/g, "")}`;
}

/** Iniciais para o avatar do responsável ("Ana Souza" → "AS"). */
function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const first = parts[0]?.[0] ?? "";
  const last = parts.length > 1 ? parts[parts.length - 1][0] : "";
  return (first + last).toUpperCase();
}

/**
 * Reveal ao rolar. Reexecuta quando `deps` muda (ex.: dados assíncronos que
 * inserem novos `[data-reveal]` no DOM depois da montagem) e só observa os que
 * ainda não foram revelados, evitando que cards renderizados após o fetch
 * fiquem presos em opacity 0.
 */
function useReveal(deps: unknown[] = []) {
  useEffect(() => {
    const els = Array.from(document.querySelectorAll<HTMLElement>("[data-reveal]:not(.lp-in)"));
    if (els.length === 0) return;
    if (!("IntersectionObserver" in window)) {
      els.forEach((el) => el.classList.add("lp-in"));
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add("lp-in");
            io.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.12, rootMargin: "0px 0px -8% 0px" },
    );
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}

export function LandingPage() {
  const [company, setCompany] = useState<PublicCompanyProfile | null>(null);
  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [fabOpen, setFabOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useReveal([company]);

  useEffect(() => {
    const ac = new AbortController();
    organizationApi
      .getPublicCompany({ signal: ac.signal })
      .then(setCompany)
      .catch(() => undefined);
    return () => ac.abort();
  }, []);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const name = company?.name ?? BRAND.name;
  const segment = company?.segment ?? "HVAC-R";
  const email = company?.email ?? null;
  const phone = company?.phones?.[0] ?? null;
  const website = company?.website ?? null;
  const location = useMemo(() => {
    if (!company?.city) return null;
    return company.state ? `${company.city} · ${company.state}` : company.city;
  }, [company]);

  // Botões gerais (hero, serviços, resultados) falam com o contato principal;
  // a seção de contato e o botão flutuante mostram cada responsável.
  const whatsappUrl = company?.whatsapp ? waLink(company.whatsapp, WHATSAPP_MESSAGE) : null;
  const contacts: PublicCompanyContact[] = company?.contacts ?? [];
  // Números exibidos em "Fale com a gente": um por responsável (nome e função
  // como legenda) ou, sem responsáveis cadastrados, o WhatsApp/telefones gerais.
  const caption = (c: PublicCompanyContact) => [c.name, c.role].filter(Boolean).join(" · ");
  const whatsappLines =
    contacts.length > 0
      ? contacts
          .filter((c) => c.whatsapp)
          .map((c) => ({
            phone: c.phone,
            caption: caption(c),
            href: waLink(c.whatsapp as string, WHATSAPP_MESSAGE),
          }))
      : whatsappUrl
        ? [{ phone: phone ?? "Enviar mensagem", caption: "", href: whatsappUrl }]
        : [];
  const phoneLines =
    contacts.length > 0
      ? contacts.map((c) => ({ phone: c.phone, caption: caption(c) }))
      : (company?.phones ?? []).slice(0, 2).map((p) => ({ phone: p, caption: "" }));
  // Opcional por empresa: sem ORGANIZATION_INSTAGRAM na API, nada aparece.
  const instagram = company?.instagram ?? null;
  const whatsappContacts = contacts.filter((c): c is PublicCompanyContact & { whatsapp: string } =>
    Boolean(c.whatsapp),
  );

  const accentStyle = company
    ? ({
        "--lp-primary": company.primaryColor,
        "--lp-secondary": company.secondaryColor,
      } as React.CSSProperties)
    : undefined;

  return (
    <div ref={rootRef} className="lp-root" style={accentStyle}>
      <style>{LP_CSS}</style>

      {/* ---------- Header ---------- */}
      <header className={`lp-header ${scrolled ? "lp-header--solid" : ""}`}>
        <div className="lp-container lp-header__inner">
          <a href="#inicio" className="lp-brand" aria-label={name}>
            <BrandLogo height={26} alt={name} />
          </a>

          <nav className="lp-nav" aria-label="Seções">
            {NAV.map((item) => (
              <a key={item.href} href={item.href} className="lp-nav__link">
                {item.label}
              </a>
            ))}
          </nav>

          <div className="lp-header__actions">
            <Link href="/login" className="lp-btn lp-btn--ghost">
              Gestão
            </Link>
            <Link href="/customer/login" className="lp-btn lp-btn--primary lp-hide-sm">
              <UserRound size={16} /> Portal do cliente
            </Link>
            <button
              type="button"
              className="lp-menu-btn"
              aria-label="Abrir menu"
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen((v) => !v)}
            >
              {menuOpen ? <X size={22} /> : <Menu size={22} />}
            </button>
          </div>
        </div>

        {menuOpen && (
          <div className="lp-mobile-menu">
            {NAV.map((item) => (
              <a
                key={item.href}
                href={item.href}
                className="lp-mobile-menu__link"
                onClick={() => setMenuOpen(false)}
              >
                {item.label}
              </a>
            ))}
            <Link href="/login" className="lp-mobile-menu__link" onClick={() => setMenuOpen(false)}>
              Acesso à gestão
            </Link>
            <Link href="/customer/login" className="lp-mobile-menu__link" onClick={() => setMenuOpen(false)}>
              Portal do cliente
            </Link>
          </div>
        )}
      </header>

      {/* ---------- Hero ---------- */}
      {/* Composição centralizada: a evaporadora fica fixa no topo e o texto
          vem logo abaixo. O único movimento é a neve caindo por todo o bloco. */}
      <section id="inicio" className="lp-hero">
        <div className="lp-hero__glow" aria-hidden />
        <div className="lp-snow" aria-hidden>
          {SNOWFLAKES.map((flake, i) => (
            <span
              key={i}
              className="lp-snow__flake"
              style={
                {
                  left: `${flake.left}%`,
                  "--lp-flake-size": `${flake.size}px`,
                  "--lp-flake-drift": `${flake.drift}px`,
                  "--lp-flake-opacity": flake.opacity,
                  animationDuration: `${flake.duration}s`,
                  animationDelay: `${flake.delay}s`,
                } as React.CSSProperties
              }
            >
              <Snowflake size={flake.size} />
            </span>
          ))}
        </div>

        <div className="lp-container lp-hero__inner">
          {HERO_ART === "logo" ? (
            // Logomarca em destaque, igual à logo oficial (/brand/logo.png, com
            // o miolo branco — legível nos dois temas), sobre um halo suave.
            <div className="lp-mark" data-reveal>
              <img
                src="/brand/logo.png"
                alt={name}
                width={1000}
                height={280}
                className="lp-mark__img"
              />
            </div>
          ) : (
            <div
              className="lp-ac"
              role="img"
              aria-label={`${name} — ar-condicionado split`}
              data-reveal
            >
              <div className="lp-ac__scene" aria-hidden>
                {/* Evaporadora com a logo no painel e o ar insuflado. */}
                <div className="lp-ac__front">
                  <div className="lp-ac__unit">
                    <img src="/landing/evaporadora.webp" alt="" width={1120} height={370} />
                    <img className="lp-ac__logo" src="/landing/logo-painel.webp" alt="" width={900} height={252} />
                  </div>
                  <img className="lp-ac__air" src="/landing/fluxo-ar.webp" alt="" width={1120} height={330} />
                </div>
              </div>
            </div>
          )}

          <div className="lp-hero__content" data-reveal>
            <span className="lp-badge">
              <Snowflake size={14} /> Assistência Técnica
            </span>
            <h1 className="lp-hero__title">
              O clima <span className="lp-accent">na medida certa</span> para cada ambiente.
            </h1>
            <p className="lp-hero__lead">
              Da instalação à manutenção preventiva, a {name} mantém seu ar-condicionado e seus
              equipamentos de refrigeração rendendo o máximo — com relatórios{" "}
              <strong>100% digitais</strong>, assinados por responsável técnico credenciado.
            </p>
            <div className="lp-hero__cta">
              {whatsappUrl ? (
                <WhatsAppLink href={whatsappUrl} className="lp-btn lp-btn--primary lp-btn--lg">
                  <MessageCircle size={18} /> Falar no WhatsApp
                </WhatsAppLink>
              ) : (
                <a href="#contato" className="lp-btn lp-btn--primary lp-btn--lg">
                  <MessageCircle size={18} /> Fale com a gente
                </a>
              )}
              <a href="#servicos" className="lp-btn lp-btn--outline lp-btn--lg">
                Ver serviços <ArrowRight size={18} />
              </a>
            </div>
            <ul className="lp-hero__facts">
              <li>
                <strong>Orçamento rápido</strong>
                <span>Direto pelo WhatsApp</span>
              </li>
              <li>
                <strong>PMOC em dia</strong>
                <span>Conformidade legal</span>
              </li>
              <li>
                <strong>Laudos digitais</strong>
                <span>Assinatura técnica</span>
              </li>
            </ul>
          </div>
        </div>
      </section>

      {/* ---------- Serviços ---------- */}
      <section id="servicos" className="lp-section">
        <div className="lp-container">
          <header className="lp-section__head" data-reveal>
            <span className="lp-eyebrow">Nossos serviços</span>
            <h2 className="lp-section__title">Tudo o que o seu ar-condicionado precisa, em um só lugar</h2>
            <p className="lp-section__sub">
              Da instalação ao contrato de manutenção contínua: acompanhamos o equipamento em todas
              as fases, do primeiro dia ao último.
            </p>
          </header>
          <div className="lp-svc-grid">
            {SERVICES.map(({ icon: Icon, title, text, image, focus, cta, request }, i) => {
              const ctaUrl = company?.whatsapp
                ? waLink(company.whatsapp, serviceRequestMessage(name, request))
                : null;
              return (
                <article key={title} className="lp-svc" data-reveal style={{ transitionDelay: `${i * 60}ms` }}>
                  <div className="lp-svc__media">
                    <img
                      src={image}
                      alt={title}
                      loading="lazy"
                      style={{ objectPosition: focus }}
                      onError={(e) => {
                        (e.currentTarget as HTMLImageElement).style.display = "none";
                      }}
                    />
                    <span className="lp-svc__media-fallback" aria-hidden>
                      <Icon size={40} />
                    </span>
                  </div>
                  <div className="lp-svc__body">
                    <span className="lp-svc__icon" aria-hidden>
                      <Icon size={22} />
                    </span>
                    <h3 className="lp-svc__title">{title}</h3>
                    <p className="lp-svc__text">{text}</p>
                    {/* Sem WhatsApp disponível, o botão leva ao contato em vez de sumir. */}
                    {ctaUrl ? (
                      <WhatsAppLink href={ctaUrl} className="lp-svc__cta">
                        <MessageCircle size={16} /> {cta}
                      </WhatsAppLink>
                    ) : (
                      <a href="#contato" className="lp-svc__cta">
                        {cta} <ArrowRight size={16} />
                      </a>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
          <div className="lp-benefits" data-reveal>
            {[
              { icon: MessageCircle, label: "Orçamento pelo WhatsApp" },
              { icon: ShieldCheck, label: "Responsável técnico credenciado" },
              { icon: Gauge, label: "Menos gasto com energia" },
              { icon: Snowflake, label: "Ar mais limpo no ambiente" },
            ].map(({ icon: Icon, label }) => (
              <div key={label} className="lp-benefit">
                <Icon size={20} />
                <span>{label}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ---------- Resultados (prova social / números) ---------- */}
      <section id="resultados" className="lp-section lp-section--muted">
        <div className="lp-container lp-results lp-results--reverse">
          {/* Colagem com fotos verticais da equipe: corretiva e projeto ao fundo,
              a equipe em destaque ao centro. */}
          <div className="lp-collage" data-reveal>
            <figure className="lp-collage__item lp-collage__item--back-left">
              <img src="/servicos/manutencao-corretiva.webp" alt="Técnico em manutenção corretiva" loading="lazy" style={{ objectPosition: "8% 22%" }} />
            </figure>
            <figure className="lp-collage__item lp-collage__item--back-right">
              <img src="/servicos/projetos.webp" alt="Equipe executando projeto de climatização" loading="lazy" style={{ objectPosition: "center 65%" }} />
            </figure>
            <figure className="lp-collage__item lp-collage__item--front">
              <img src="/servicos/pmoc.webp" alt={`Equipe ${name}`} loading="lazy" style={{ objectPosition: "center 45%" }} />
            </figure>
            <div className="lp-collage__seal" aria-label="Garantia e qualidade">
              <ShieldCheck size={22} />
              <div>
                <strong>Garantia</strong>
                <span>e Qualidade</span>
              </div>
            </div>
          </div>

          <div className="lp-results__content" data-reveal>
            <span className="lp-eyebrow">Resultados</span>
            <h2 className="lp-section__title">Ambiente na temperatura certa e cliente sem dor de cabeça</h2>
            <p className="lp-section__sub">
              Equipe própria, horário cumprido e serviço feito para não ter retorno. Cada ambiente
              recebe a solução que o seu uso pede — e cada entrega vem documentada, do diagnóstico
              à assinatura do técnico.
            </p>

            <div className="lp-metrics">
              {COMPANY_METRICS.map(({ icon: Icon, value, label }) => (
                <div key={label} className="lp-metric">
                  <span className="lp-metric__icon">
                    <Icon size={18} />
                  </span>
                  <strong className="lp-metric__value">{value}</strong>
                  <span className="lp-metric__label">{label}</span>
                </div>
              ))}
            </div>

            <div className="lp-guarantee">
              <ShieldCheck size={20} />
              <p>
                <strong>Serviço com garantia.</strong> Executamos tudo dentro das normas técnicas e
                entregamos relatório assinado por responsável técnico credenciado.
              </p>
            </div>

            <div className="lp-hero__cta">
              {whatsappUrl ? (
                <WhatsAppLink href={whatsappUrl} className="lp-btn lp-btn--primary lp-btn--lg">
                  <MessageCircle size={18} /> Solicitar orçamento
                </WhatsAppLink>
              ) : (
                <a href="#contato" className="lp-btn lp-btn--primary lp-btn--lg">
                  <MessageCircle size={18} /> Solicitar orçamento
                </a>
              )}
              {instagram && (
                <a
                  href={instagram.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="lp-btn lp-btn--outline lp-btn--lg"
                >
                  <Instagram size={18} /> Ver trabalhos no Instagram
                </a>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* ---------- Clientes (logos fixas; esteira opcional) ---------- */}
      {/* Esteira (CLIENTS_MARQUEE): a trilha tem duas metades idênticas e anda -50%: quando a primeira
          sai da tela, a segunda está exatamente no lugar dela (loop sem emenda).
          A segunda metade é decorativa (aria-hidden) para leitores de tela. */}
      <section id="clientes" className="lp-section lp-clients" aria-labelledby="lp-clients-title">
        <div className="lp-container">
          <header className="lp-section__head" data-reveal>
            <span className="lp-eyebrow">Nossos clientes</span>
            <h2 id="lp-clients-title" className="lp-section__title">
              Empresas que confiam no nosso trabalho
            </h2>
          </header>
        </div>
        {CLIENTS_MARQUEE ? (
          <div className="lp-marquee" data-reveal>
            <div className="lp-marquee__track">
              {[0, 1].map((half) => (
                <ul key={half} className="lp-marquee__group" aria-hidden={half === 1 || undefined}>
                  {Array.from({ length: CLIENT_REPEAT }).flatMap((_, round) =>
                    CLIENTS.map((client) => (
                      <li
                        key={`${round}-${client.name}`}
                        className={`lp-client ${round > 0 ? "lp-client--copy" : ""}`}
                      >
                        <img
                          src={client.logo}
                          alt={half === 0 && round === 0 ? client.name : ""}
                          width={400}
                          height={400}
                          loading="lazy"
                        />
                      </li>
                    )),
                  )}
                </ul>
              ))}
            </div>
          </div>
        ) : (
          <div className="lp-container">
            <ul className="lp-clients__grid" data-reveal>
              {CLIENTS.map((client) => (
                <li key={client.name} className="lp-client" title={client.name}>
                  <img src={client.logo} alt={client.name} width={400} height={400} loading="lazy" />
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      {/* ---------- Benefícios da manutenção preventiva (carrossel) ---------- */}
      <PreventiveBenefitsSection />

      {/* ---------- A empresa ---------- */}
      <section id="empresa" className="lp-section">
        <div className="lp-container lp-about lp-about--reverse">
          <div className="lp-about__text" data-reveal>
            <span className="lp-eyebrow">A empresa</span>
            <h2 className="lp-section__title">Quem cuida do seu clima</h2>
            <p className="lp-section__sub">
              A {name} é especialista em ar-condicionado e refrigeração ({segment}) e atende
              residências, comércios e indústrias. Trabalhamos com proximidade: você sabe quem vai
              ao local, o que foi feito e por quê — tudo registrado e assinado.
            </p>
            <ul className="lp-checklist">
              {[
                "Técnicos qualificados e responsável técnico credenciado",
                "Atendimento direto com os responsáveis pela empresa",
                "Procedimentos padronizados e rastreáveis",
                "Serviço dentro das normas do setor",
              ].map((item) => (
                <li key={item}>
                  <ShieldCheck size={18} /> {item}
                </li>
              ))}
            </ul>
          </div>
          <div className="lp-about__stats" data-reveal>
            {[
              { k: "Residencial", v: "Casas e apartamentos" },
              { k: "Comercial", v: "Lojas, escritórios e clínicas" },
              { k: "Industrial", v: "Refrigeração de processos" },
              { k: "100% digital", v: "PMOC · RVT · OS assinados" },
            ].map((s) => (
              <div key={s.v} className="lp-stat">
                <strong>{s.k}</strong>
                <span>{s.v}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ---------- Documentação / Relatórios ---------- */}
      <section id="relatorios" className="lp-section lp-section--muted">
        <div className="lp-container lp-docs">
          <div className="lp-docs__intro" data-reveal>
            <span className="lp-eyebrow">Documentação técnica</span>
            <h2 className="lp-section__title">Cada atendimento vira um documento assinado</h2>
            <p className="lp-section__sub">
              Nada de papel perdido: os relatórios são emitidos no sistema, assinados pelo
              responsável técnico e ficam disponíveis para você no portal do cliente.
            </p>
            <div className="lp-signature-note" data-reveal>
              <FileSignature size={18} />
              <span>
                Assinatura digital do responsável técnico: validade, rastreabilidade e transparência
                em cada visita.
              </span>
            </div>
          </div>
          <div className="lp-docs__list">
            {REPORTS.map(({ icon: Icon, title, text }, i) => (
              <article key={title} className="lp-card lp-card--report" data-reveal style={{ transitionDelay: `${i * 60}ms` }}>
                <span className="lp-card__icon">
                  <Icon size={22} />
                </span>
                <div>
                  <h3 className="lp-card__title">{title}</h3>
                  <p className="lp-card__text">{text}</p>
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* ---------- Contato ---------- */}
      <section id="contato" className="lp-section">
        <div className="lp-container">
          <header className="lp-section__head" data-reveal>
            <span className="lp-eyebrow">Fale com a gente</span>
            <h2 className="lp-section__title">Vamos climatizar o seu ambiente</h2>
            <p className="lp-section__sub">
              Solicite um orçamento ou tire suas dúvidas pelos canais abaixo.
            </p>
          </header>

          {/* Uma linha de cards compactos. WhatsApp e Telefone listam um ou mais
              números (um por responsável, quando cadastrados). */}
          <div className="lp-grid lp-grid--contact">
            {whatsappLines.length > 0 && (
              <div className="lp-contact lp-contact--primary" data-reveal>
                <span className="lp-contact__icon">
                  <MessageCircle size={20} />
                </span>
                <span className="lp-contact__label">WhatsApp</span>
                <div className="lp-contact__lines">
                  {whatsappLines.map((line) => (
                    <WhatsAppLink key={line.href} href={line.href} className="lp-contact__line">
                      <span className="lp-contact__line-main">
                        <strong>{line.phone}</strong>
                        {line.caption && <small>{line.caption}</small>}
                      </span>
                      <ArrowRight size={15} />
                    </WhatsAppLink>
                  ))}
                </div>
              </div>
            )}

            {phoneLines.length > 0 && (
              <div className="lp-contact" data-reveal>
                <span className="lp-contact__icon">
                  <Phone size={20} />
                </span>
                <span className="lp-contact__label">Telefone</span>
                <div className="lp-contact__lines">
                  {phoneLines.map((line) => (
                    <a key={line.phone} href={telLink(line.phone)} className="lp-contact__line">
                      <span className="lp-contact__line-main">
                        <strong>{line.phone}</strong>
                        {line.caption && <small>{line.caption}</small>}
                      </span>
                      <ArrowRight size={15} />
                    </a>
                  ))}
                </div>
              </div>
            )}

            {email && (
              <a href={`mailto:${email}`} className="lp-contact" data-reveal>
                <span className="lp-contact__icon">
                  <Mail size={20} />
                </span>
                <span className="lp-contact__label">E-mail</span>
                {/* Quebra o endereço no @ em vez de no meio de uma palavra. */}
                <span className="lp-contact__value lp-contact__value--email">
                  {email.split("@")[0]}@<wbr />
                  {email.split("@").slice(1).join("@")}
                </span>
                <span className="lp-contact__cta">
                  Enviar e-mail <ArrowRight size={15} />
                </span>
              </a>
            )}

            {instagram && (
              <a
                href={instagram.url}
                target="_blank"
                rel="noopener noreferrer"
                className="lp-contact lp-contact--instagram"
                data-reveal
              >
                <span className="lp-contact__icon">
                  <Instagram size={20} />
                </span>
                <span className="lp-contact__label">Instagram</span>
                {/* Usuários longos quebram só depois de "_" ou ".", nunca no meio da palavra. */}
                <span className="lp-contact__value lp-contact__value--handle">
                  @
                  {instagram.handle.split(/(?<=[._])/).map((part, i) => (
                    <Fragment key={i}>
                      {i > 0 && <wbr />}
                      {part}
                    </Fragment>
                  ))}
                </span>
                <span className="lp-contact__cta">
                  Seguir perfil <ArrowRight size={15} />
                </span>
              </a>
            )}

            {location && (
              <div className="lp-contact" data-reveal>
                <span className="lp-contact__icon">
                  <MapPin size={20} />
                </span>
                <span className="lp-contact__label">Localização</span>
                <span className="lp-contact__value">{location}</span>
                <span className="lp-contact__cta lp-contact__cta--static">Atendemos a região</span>
              </div>
            )}
          </div>
        </div>
      </section>

      {/* ---------- Footer ---------- */}
      <footer className="lp-footer">
        <div className="lp-container lp-footer__inner">
          <div className="lp-footer__brand">
            <BrandLogo height={30} alt={name} />
            <p>Climatização e refrigeração · Segmento {segment}</p>
            {instagram && (
              <a
                href={instagram.url}
                target="_blank"
                rel="noopener noreferrer"
                className="lp-footer__social"
              >
                <span className="lp-ig-btn lp-ig-btn--sm" aria-hidden>
                  <Instagram size={15} />
                </span>
                @{instagram.handle}
              </a>
            )}
          </div>
          <div className="lp-footer__links">
            {NAV.map((item) => (
              <a key={item.href} href={item.href}>
                {item.label}
              </a>
            ))}
            <Link href="/login">Acesso à gestão</Link>
            {/* Revogar/rever o consentimento de cookies (LGPD art. 8º §5º).
                Só aparece quando há rastreamento configurado. */}
            {GOOGLE_ADS_ID && (
              <button type="button" className="lp-footer__link-btn" onClick={openCookiePreferences}>
                Preferências de cookies
              </button>
            )}
          </div>
          <div className="lp-footer__meta">
            {website && (
              <a href={website.startsWith("http") ? website : `https://${website}`} target="_blank" rel="noopener noreferrer">
                {website.replace(/^https?:\/\//, "")}
              </a>
            )}
            <span>
              © {new Date().getFullYear()} {name}. Todos os direitos reservados.
            </span>
          </div>
        </div>
      </footer>

      {/* ---------- WhatsApp flutuante ---------- */}
      {/* Com mais de um responsável no WhatsApp, o botão abre a escolha de
          com quem falar; com um só, vai direto para a conversa. */}
      {whatsappContacts.length > 1 ? (
        <div className="lp-fab-wrap">
          {fabOpen && (
            <div className="lp-fab-menu" role="menu" aria-label="Falar no WhatsApp com">
              <span className="lp-fab-menu__title">Falar no WhatsApp com</span>
              {whatsappContacts.map((contact) => (
                <WhatsAppLink
                  key={`${contact.name}-${contact.whatsapp}`}
                  href={waLink(contact.whatsapp, WHATSAPP_MESSAGE)}
                  className="lp-fab-menu__item"
                  role="menuitem"
                >
                  <span className="lp-person__avatar lp-person__avatar--sm" aria-hidden>
                    {initials(contact.name)}
                  </span>
                  <span className="lp-fab-menu__text">
                    <strong>{contact.name}</strong>
                    <span>{contact.role ?? contact.phone}</span>
                  </span>
                </WhatsAppLink>
              ))}
            </div>
          )}
          <button
            type="button"
            className="lp-fab"
            aria-label="Falar no WhatsApp"
            aria-haspopup="menu"
            aria-expanded={fabOpen}
            onClick={() => setFabOpen((v) => !v)}
          >
            {fabOpen ? <X size={26} /> : WHATSAPP_ICON}
          </button>
        </div>
      ) : (
        whatsappUrl && (
          <WhatsAppLink href={whatsappUrl} className="lp-fab" aria-label="Falar no WhatsApp">
            {WHATSAPP_ICON}
          </WhatsAppLink>
        )
      )}
    </div>
  );
}

const WHATSAPP_ICON = (
  <svg viewBox="0 0 32 32" width="30" height="30" fill="currentColor" aria-hidden>
            <path d="M16.003 3.2c-7.06 0-12.8 5.74-12.8 12.8 0 2.257.594 4.454 1.72 6.395L3.2 28.8l6.57-1.717a12.74 12.74 0 0 0 6.23 1.62h.005c7.06 0 12.8-5.74 12.8-12.8 0-3.42-1.332-6.635-3.75-9.053A12.72 12.72 0 0 0 16.003 3.2zm0 2.133a10.63 10.63 0 0 1 7.548 3.126 10.6 10.6 0 0 1 3.12 7.542c0 5.884-4.786 10.667-10.67 10.667a10.62 10.62 0 0 1-5.41-1.48l-.388-.23-4.03 1.053 1.076-3.926-.253-.403a10.6 10.6 0 0 1-1.626-5.68c0-5.883 4.786-10.666 10.67-10.666zm-5.87 5.744c-.196 0-.514.074-.784.37-.27.294-1.03 1.006-1.03 2.452 0 1.446 1.055 2.843 1.202 3.04.147.196 2.076 3.17 5.03 4.446.703.303 1.25.485 1.678.62.705.224 1.346.192 1.853.117.565-.084 1.74-.712 1.986-1.4.245-.686.245-1.274.172-1.4-.074-.123-.27-.196-.564-.343-.294-.147-1.74-.858-2.01-.956-.27-.098-.466-.147-.662.148-.196.294-.76.955-.93 1.15-.172.197-.343.222-.637.075-.294-.148-1.24-.457-2.363-1.458-.873-.778-1.463-1.74-1.634-2.034-.17-.294-.018-.453.13-.6.132-.132.294-.343.44-.514.148-.172.196-.294.294-.49.098-.197.05-.368-.025-.515-.074-.147-.646-1.6-.91-2.18-.235-.516-.474-.447-.662-.456l-.564-.01z"/>
          </svg>
);

const LP_CSS = `
html { scroll-behavior: smooth; }
.lp-root {
  --lp-primary: var(--color-primary, #1e73e8);
  --lp-secondary: var(--color-primary, #0ea5e9);
  color: var(--color-foreground);
  background: var(--color-background);
  overflow-x: clip;
}
.lp-container { width: 100%; max-width: 1160px; margin: 0 auto; padding: 0 24px; }

[data-reveal] { opacity: 0; transform: translateY(22px); transition: opacity .7s ease, transform .7s cubic-bezier(.2,.7,.2,1); }
[data-reveal].lp-in { opacity: 1; transform: none; }
@media (prefers-reduced-motion: reduce) {
  html { scroll-behavior: auto; }
  [data-reveal] { opacity: 1 !important; transform: none !important; transition: none; }
}

/* Header */
.lp-header { position: sticky; top: 0; z-index: 50; transition: background .3s ease, box-shadow .3s ease, backdrop-filter .3s ease; }
.lp-header--solid { background: color-mix(in srgb, var(--color-background) 82%, transparent); backdrop-filter: blur(12px); box-shadow: 0 1px 0 color-mix(in srgb, var(--color-foreground) 8%, transparent); }
.lp-header__inner { display: flex; align-items: center; gap: 20px; height: 68px; }
.lp-brand { display: inline-flex; align-items: center; }
.lp-nav { display: flex; gap: 4px; margin-left: 12px; }
.lp-nav__link { padding: 8px 12px; border-radius: 8px; font-size: 14px; font-weight: 500; color: color-mix(in srgb, var(--color-foreground) 72%, transparent); text-decoration: none; transition: color .2s, background .2s; }
.lp-nav__link:hover { color: var(--color-foreground); background: color-mix(in srgb, var(--color-foreground) 6%, transparent); }
.lp-header__actions { display: flex; align-items: center; gap: 10px; margin-left: auto; }
.lp-menu-btn { display: none; align-items: center; justify-content: center; width: 40px; height: 40px; border-radius: 10px; border: 1px solid color-mix(in srgb, var(--color-foreground) 12%, transparent); background: transparent; color: var(--color-foreground); cursor: pointer; }
.lp-mobile-menu { display: none; flex-direction: column; padding: 8px 24px 16px; gap: 2px; background: color-mix(in srgb, var(--color-background) 92%, transparent); backdrop-filter: blur(12px); border-bottom: 1px solid color-mix(in srgb, var(--color-foreground) 8%, transparent); }
.lp-mobile-menu__link { padding: 12px 8px; border-radius: 8px; font-size: 15px; font-weight: 500; color: var(--color-foreground); text-decoration: none; }
.lp-mobile-menu__link:hover { background: color-mix(in srgb, var(--color-foreground) 6%, transparent); }

/* Buttons */
.lp-btn { display: inline-flex; align-items: center; gap: 8px; height: 40px; padding: 0 16px; border-radius: 10px; font-size: 14px; font-weight: 600; text-decoration: none; cursor: pointer; border: 1px solid transparent; transition: transform .15s ease, box-shadow .2s ease, background .2s ease, border-color .2s ease; white-space: nowrap; }
.lp-btn:hover { transform: translateY(-1px); }
.lp-btn--lg { height: 48px; padding: 0 22px; font-size: 15px; border-radius: 12px; }
.lp-btn--primary { background: var(--lp-primary); color: #fff; box-shadow: 0 8px 22px color-mix(in srgb, var(--lp-primary) 35%, transparent); }
.lp-btn--primary:hover { box-shadow: 0 12px 28px color-mix(in srgb, var(--lp-primary) 45%, transparent); }
.lp-btn--outline { border-color: color-mix(in srgb, var(--color-foreground) 18%, transparent); color: var(--color-foreground); background: transparent; }
.lp-btn--outline:hover { border-color: var(--lp-primary); color: var(--lp-primary); }
.lp-btn--ghost { color: var(--color-foreground); background: color-mix(in srgb, var(--color-foreground) 6%, transparent); }
.lp-btn--ghost:hover { background: color-mix(in srgb, var(--color-foreground) 12%, transparent); }

/* Hero: arte centralizada no topo, texto centralizado abaixo, neve caindo */
.lp-hero { position: relative; padding: 40px 0 84px; overflow: clip; isolation: isolate;
  background: linear-gradient(180deg, color-mix(in srgb, var(--lp-primary) 10%, transparent), transparent 78%); }
.lp-hero__glow { position: absolute; inset: 0; z-index: -1; pointer-events: none; background:
  radial-gradient(48% 42% at 50% 22%, color-mix(in srgb, var(--lp-primary) 26%, transparent), transparent 72%),
  radial-gradient(30% 30% at 12% 70%, color-mix(in srgb, var(--lp-secondary) 14%, transparent), transparent 70%),
  radial-gradient(30% 30% at 88% 64%, color-mix(in srgb, var(--lp-secondary) 14%, transparent), transparent 70%); }
.lp-hero__inner { position: relative; z-index: 1; display: flex; flex-direction: column; align-items: center; text-align: center; }
.lp-hero__content { display: flex; flex-direction: column; align-items: center; max-width: 760px; }
.lp-badge { display: inline-flex; align-items: center; gap: 7px; padding: 6px 12px; border-radius: 999px; font-size: 13px; font-weight: 600; color: var(--lp-primary); background: color-mix(in srgb, var(--lp-primary) 12%, transparent); border: 1px solid color-mix(in srgb, var(--lp-primary) 22%, transparent); }
.lp-hero__title { margin: 18px 0 0; font-size: clamp(2.1rem, 5vw, 3.6rem); line-height: 1.06; font-weight: 800; letter-spacing: -0.02em; max-width: 18ch; }
.lp-accent { background: linear-gradient(100deg, var(--lp-primary), var(--lp-secondary)); -webkit-background-clip: text; background-clip: text; color: transparent; }
.lp-hero__lead { margin: 20px auto 0; font-size: clamp(1rem, 1.6vw, 1.15rem); line-height: 1.6; color: color-mix(in srgb, var(--color-foreground) 74%, transparent); max-width: 60ch; }
.lp-hero__cta { display: flex; flex-wrap: wrap; justify-content: center; gap: 12px; margin-top: 28px; }
.lp-hero__facts { list-style: none; display: flex; flex-wrap: wrap; justify-content: center; gap: 12px 36px; margin: 34px 0 0; padding: 0; }
.lp-hero__facts li { display: flex; flex-direction: column; align-items: center; }
.lp-hero__facts strong { font-size: 15px; }
.lp-hero__facts span { font-size: 13px; color: color-mix(in srgb, var(--color-foreground) 60%, transparent); }

/* Neve: cobre o bloco inteiro, cai de cima a baixo com leve deriva lateral. */
.lp-snow { position: absolute; inset: 0; z-index: 0; overflow: hidden; pointer-events: none; }
.lp-snow__flake { position: absolute; top: -24px; display: block; line-height: 0;
  color: color-mix(in srgb, var(--lp-primary) 45%, #bfe3ff); opacity: 0;
  animation: lp-snow-fall linear infinite; will-change: transform; }
@keyframes lp-snow-fall {
  0% { transform: translate3d(0, 0, 0) rotate(0deg); opacity: 0; }
  8% { opacity: var(--lp-flake-opacity, .5); }
  85% { opacity: var(--lp-flake-opacity, .5); }
  100% { transform: translate3d(var(--lp-flake-drift, 0px), 920px, 0) rotate(220deg); opacity: 0; }
}
@media (prefers-reduced-motion: reduce) { .lp-snow { display: none; } }

/* Logomarca em destaque, com um halo frio por trás. */
.lp-mark { position: relative; width: min(450px, 84%); margin: 34px auto 30px; }
.lp-mark::before { content: ""; position: absolute; inset: -30% -12%; z-index: -1; border-radius: 50%;
  background: radial-gradient(closest-side, color-mix(in srgb, var(--lp-primary) 20%, transparent), transparent); }
.lp-mark__img { display: block; width: 100%; height: auto;
  filter: drop-shadow(0 14px 30px color-mix(in srgb, var(--lp-primary) 28%, transparent)); }

/* Evaporadora real (recorte da foto), fixa, com o ar insuflado abaixo. */
.lp-ac { position: relative; width: 100%; max-width: 500px; margin-bottom: 14px; }
.lp-ac::before { content: ""; position: absolute; inset: 6% -12% 0; z-index: -1; border-radius: 50%;
  background: radial-gradient(closest-side, color-mix(in srgb, var(--lp-primary) 22%, transparent), transparent); }
.lp-ac__scene { position: relative; width: 100%; }
.lp-ac img { display: block; width: 100%; height: auto; }
.lp-ac__front { position: relative; width: 88%; margin: 18px auto 0;
  filter: drop-shadow(0 26px 36px rgba(8, 15, 30, .45)); }
.lp-ac__unit { position: relative; }
/* Marca centralizada no painel frontal (área branca acima do friso de luz). */
.lp-ac .lp-ac__logo { position: absolute; left: 51%; top: 39%; width: 42%; transform: translate(-50%, -50%); }
/* Ar insuflado: peça separada; a máscara evita o corte reto na base. */
.lp-ac__air { margin-top: -1.5%;
  -webkit-mask-image: linear-gradient(to bottom, #000 50%, transparent 96%);
  mask-image: linear-gradient(to bottom, #000 50%, transparent 96%); }

/* Serviços: card com foto, ícone sobreposto e CTA */
.lp-svc-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 24px; }
.lp-svc { position: relative; display: flex; flex-direction: column; overflow: hidden; border-radius: 22px; background: var(--color-background);
  border: 1px solid color-mix(in srgb, var(--color-foreground) 9%, transparent);
  box-shadow: 0 10px 30px color-mix(in srgb, var(--color-foreground) 7%, transparent);
  transition: transform .3s cubic-bezier(.2,.7,.2,1), box-shadow .3s ease, border-color .3s ease; }
.lp-svc:hover { transform: translateY(-6px); border-color: color-mix(in srgb, var(--lp-primary) 38%, transparent);
  box-shadow: 0 24px 54px color-mix(in srgb, var(--lp-primary) 20%, transparent); }
.lp-svc__media { position: relative; aspect-ratio: 16 / 11; overflow: hidden;
  background: linear-gradient(135deg, color-mix(in srgb, var(--lp-primary) 22%, transparent), color-mix(in srgb, var(--lp-secondary) 12%, transparent)); }
.lp-svc__media img { position: absolute; inset: 0; z-index: 1; width: 100%; height: 100%; object-fit: cover; object-position: center 35%; transition: transform .6s cubic-bezier(.2,.7,.2,1); }
.lp-svc:hover .lp-svc__media img { transform: scale(1.06); }
/* Degradê na base da foto: funde a foto com o card. */
.lp-svc__media::after { content: ""; position: absolute; inset: 0; z-index: 2;
  background: linear-gradient(180deg, rgba(8, 15, 35, .05) 40%, rgba(8, 15, 35, .55)); }
/* Ícone só aparece quando a foto não carrega: fica na camada de baixo. */
.lp-svc__media-fallback { position: absolute; inset: 0; z-index: 0; display: flex; align-items: center; justify-content: center; color: color-mix(in srgb, var(--lp-primary) 65%, var(--color-foreground)); opacity: .55; }
.lp-svc__body { position: relative; display: flex; flex: 1; flex-direction: column; padding: 0 22px 22px; }
/* Ícone sobreposto à borda da foto: metade na imagem, metade no card. */
.lp-svc__icon { position: relative; z-index: 3; display: inline-flex; align-items: center; justify-content: center; width: 54px; height: 54px; margin-top: -27px;
  border-radius: 16px; color: #fff; background: linear-gradient(135deg, var(--lp-primary), color-mix(in srgb, var(--lp-primary) 55%, var(--lp-secondary)));
  border: 4px solid var(--color-background); box-shadow: 0 10px 22px color-mix(in srgb, var(--lp-primary) 35%, transparent); }
.lp-svc__title { margin: 14px 0 0; font-size: 1.15rem; font-weight: 700; letter-spacing: -0.01em; }
.lp-svc__text { margin: 8px 0 20px; font-size: .93rem; line-height: 1.6; color: color-mix(in srgb, var(--color-foreground) 70%, transparent); }
.lp-svc__cta { margin-top: auto; display: inline-flex; align-items: center; justify-content: center; gap: 8px; height: 46px; border-radius: 12px; font-size: 14.5px; font-weight: 700; text-decoration: none;
  color: #fff; background: linear-gradient(135deg, var(--lp-primary), color-mix(in srgb, var(--lp-primary) 70%, var(--lp-secondary)));
  box-shadow: 0 8px 20px color-mix(in srgb, var(--lp-primary) 28%, transparent); transition: transform .15s ease, box-shadow .2s ease; }
.lp-svc__cta:hover { transform: translateY(-1px); box-shadow: 0 12px 28px color-mix(in srgb, var(--lp-primary) 42%, transparent); }
.lp-benefits { margin-top: 34px; display: grid; grid-template-columns: repeat(4, 1fr); gap: 14px; }
.lp-benefit { display: flex; align-items: center; gap: 10px; padding: 14px 16px; border-radius: 14px; font-size: .92rem; font-weight: 500; background: color-mix(in srgb, var(--lp-primary) 7%, transparent); border: 1px solid color-mix(in srgb, var(--lp-primary) 15%, transparent); }
.lp-benefit svg { color: var(--lp-primary); flex: none; }

/* Resultados: colagem "embaralhada" + números de vitrine */
.lp-results { display: grid; grid-template-columns: 1fr 1fr; gap: 56px; align-items: center; }
.lp-collage { position: relative; aspect-ratio: 1 / 0.92; min-height: 380px; }
.lp-collage__item { position: absolute; margin: 0; overflow: hidden; border-radius: 20px; border: 5px solid var(--color-background); box-shadow: 0 20px 44px color-mix(in srgb, var(--color-foreground) 18%, transparent); transition: transform .35s cubic-bezier(.2,.7,.2,1); }
.lp-collage__item img { display: block; width: 100%; height: 100%; object-fit: cover; }
/* Fundo à esquerda e à direita, levemente rotacionadas; destaque ao centro. */
.lp-collage__item--back-left { width: 50%; aspect-ratio: 3 / 4; left: 0; top: 4%; transform: rotate(-7deg); z-index: 1; }
.lp-collage__item--back-right { width: 44%; aspect-ratio: 3 / 4; right: 0; top: 0; transform: rotate(6deg); z-index: 1; }
.lp-collage__item--front { width: 62%; aspect-ratio: 4 / 5; left: 50%; bottom: 0; transform: translateX(-50%) rotate(-1.5deg); z-index: 2; border-width: 6px; box-shadow: 0 30px 64px color-mix(in srgb, var(--lp-primary) 32%, transparent); }
.lp-collage:hover .lp-collage__item--back-left { transform: rotate(-10deg) translateY(-6px); }
.lp-collage:hover .lp-collage__item--back-right { transform: rotate(9deg) translateY(-6px); }
.lp-collage:hover .lp-collage__item--front { transform: translateX(-50%) rotate(0deg) translateY(-8px); }
.lp-collage__seal { position: absolute; right: 2%; bottom: 12%; z-index: 3; display: flex; align-items: center; gap: 10px; padding: 12px 16px; border-radius: 16px; background: var(--lp-primary); color: #fff; box-shadow: 0 16px 34px color-mix(in srgb, var(--lp-primary) 48%, transparent); }
.lp-collage__seal div { display: flex; flex-direction: column; line-height: 1.15; }
.lp-collage__seal strong { font-size: .95rem; }
.lp-collage__seal span { font-size: .78rem; opacity: .9; }
.lp-results__content .lp-section__title { margin-top: 12px; }
.lp-results__content .lp-section__sub { max-width: 46ch; }
.lp-metrics { display: grid; grid-template-columns: repeat(2, 1fr); gap: 16px; margin: 28px 0 22px; }
.lp-metric { padding: 18px; border-radius: 16px; background: var(--color-background); border: 1px solid color-mix(in srgb, var(--color-foreground) 9%, transparent); }
.lp-metric__icon { display: inline-flex; align-items: center; justify-content: center; width: 36px; height: 36px; border-radius: 10px; color: var(--lp-primary); background: color-mix(in srgb, var(--lp-primary) 12%, transparent); }
.lp-metric__value { display: block; margin-top: 10px; font-size: clamp(1.5rem, 2.6vw, 2rem); font-weight: 800; letter-spacing: -0.02em; color: var(--lp-primary); }
.lp-metric__label { display: block; margin-top: 2px; font-size: .88rem; color: color-mix(in srgb, var(--color-foreground) 66%, transparent); }
.lp-guarantee { display: flex; align-items: flex-start; gap: 12px; margin-bottom: 22px; padding: 16px 18px; border-radius: 14px; font-size: .93rem; line-height: 1.5; background: color-mix(in srgb, var(--lp-primary) 8%, transparent); border: 1px solid color-mix(in srgb, var(--lp-primary) 20%, transparent); }
.lp-guarantee svg { color: var(--lp-primary); flex: none; margin-top: 2px; }
.lp-guarantee p { margin: 0; }

/* Clientes: esteira horizontal contínua de logos */
.lp-clients { padding-bottom: 72px; }
.lp-clients .lp-section__head { margin-bottom: 36px; }
/* Bordas esmaecidas: as logos entram e saem suavemente da tela. */
.lp-marquee { position: relative; overflow: hidden;
  -webkit-mask-image: linear-gradient(90deg, transparent, #000 10%, #000 90%, transparent);
  mask-image: linear-gradient(90deg, transparent, #000 10%, #000 90%, transparent); }
.lp-marquee__track { display: flex; width: max-content; animation: lp-marquee 38s linear infinite; }
.lp-marquee:hover .lp-marquee__track { animation-play-state: paused; }
.lp-marquee__group { display: flex; gap: 28px; margin: 0; padding: 14px 14px 22px; list-style: none; }
.lp-client { flex: none; width: 148px; height: 148px; overflow: hidden; border-radius: 26px; background: #fff;
  border: 1px solid color-mix(in srgb, var(--color-foreground) 9%, transparent);
  box-shadow: 0 12px 30px color-mix(in srgb, var(--lp-primary) 14%, transparent);
  transition: transform .3s cubic-bezier(.2,.7,.2,1), box-shadow .3s ease; }
.lp-client:hover { transform: translateY(-6px) scale(1.04); box-shadow: 0 20px 40px color-mix(in srgb, var(--lp-primary) 24%, transparent); }
.lp-client img { display: block; width: 100%; height: 100%; object-fit: cover; }
@keyframes lp-marquee { from { transform: translateX(0); } to { transform: translateX(-50%); } }
/* Sem animação: mostra uma volta da lista, centralizada e com quebra de linha. */
@media (prefers-reduced-motion: reduce) {
  .lp-marquee { -webkit-mask-image: none; mask-image: none; }
  .lp-marquee__track { animation: none; width: auto; justify-content: center; }
  .lp-marquee__group { flex-wrap: wrap; justify-content: center; }
  .lp-marquee__group[aria-hidden] { display: none; }
  .lp-client--copy { display: none; }
}
/* Logos fixas: uma vez cada, centralizadas, quebrando linha se faltar espaço. */
.lp-clients__grid { display: flex; flex-wrap: wrap; justify-content: center; gap: 48px; margin: 0; padding: 8px 0 12px; list-style: none; }
.lp-clients__grid .lp-client { width: 168px; height: 168px; }
@media (max-width: 720px) {
  .lp-client { width: 116px; height: 116px; border-radius: 22px; }
  .lp-clients__grid { gap: 14px; }
  .lp-clients__grid .lp-client { width: 96px; height: 96px; border-radius: 20px; }
  .lp-marquee__group { gap: 18px; }
}

/* Carrossel de benefícios da preventiva */
/* Azul bem suave em degradê: o bloco todo branco pesava na página. */
.lp-carousel { position: relative; border-radius: 22px; border: 1px solid color-mix(in srgb, var(--lp-primary) 16%, transparent); background:
  linear-gradient(155deg, color-mix(in srgb, var(--lp-primary) 12%, var(--color-background)), var(--color-background) 58%),
  radial-gradient(120% 90% at 100% 0%, color-mix(in srgb, var(--lp-secondary) 12%, transparent), transparent 60%);
  box-shadow: 0 18px 44px color-mix(in srgb, var(--lp-primary) 12%, transparent); outline: none; }
.lp-carousel:focus-visible { border-color: var(--lp-primary); box-shadow: 0 0 0 3px color-mix(in srgb, var(--lp-primary) 25%, transparent); }
.lp-carousel__viewport { overflow: hidden; border-radius: 22px; }
.lp-carousel__track { display: flex; transition: transform .55s cubic-bezier(.2,.7,.2,1); }
.lp-slide { flex: 0 0 100%; display: grid; grid-template-columns: 1fr 1fr; align-items: center; gap: 48px; padding: 56px 64px; min-height: 420px; }
/* Ilustração à direita do texto no desktop; no mobile volta para o topo. */
.lp-slide__art { order: 2; display: flex; align-items: center; justify-content: center; padding: 30px; border-radius: 20px; background: linear-gradient(140deg, color-mix(in srgb, var(--lp-primary) 16%, transparent), color-mix(in srgb, var(--lp-secondary) 10%, transparent)); }
.lp-slide__svg { width: 100%; max-width: 380px; height: auto; }
.lp-slide__step { display: inline-block; font-size: .82rem; font-weight: 800; letter-spacing: .06em; color: var(--lp-primary); }
.lp-slide__step i { font-style: normal; opacity: .55; }
.lp-slide__title { margin: 10px 0 0; font-size: clamp(1.25rem, 2.3vw, 1.7rem); font-weight: 800; letter-spacing: -0.02em; }
.lp-slide__text { margin: 12px 0 0; font-size: 1rem; line-height: 1.65; color: color-mix(in srgb, var(--color-foreground) 72%, transparent); }
.lp-carousel__nav { position: absolute; top: 50%; transform: translateY(-50%); display: inline-flex; align-items: center; justify-content: center; width: 42px; height: 42px; border-radius: 50%; cursor: pointer; color: var(--lp-primary); background: var(--color-background); border: 1px solid color-mix(in srgb, var(--color-foreground) 12%, transparent); box-shadow: 0 8px 20px color-mix(in srgb, var(--color-foreground) 12%, transparent); transition: background .2s, color .2s, transform .2s; }
.lp-carousel__nav:hover { background: var(--lp-primary); color: #fff; transform: translateY(-50%) scale(1.06); }
.lp-carousel__nav--prev { left: -21px; }
.lp-carousel__nav--next { right: -21px; }
.lp-carousel__dots { display: flex; justify-content: center; gap: 8px; margin-top: 22px; }
.lp-dot { width: 9px; height: 9px; padding: 0; border: none; border-radius: 999px; cursor: pointer; background: color-mix(in srgb, var(--color-foreground) 22%, transparent); transition: width .25s ease, background .25s ease; }
.lp-dot--active { width: 30px; background: var(--lp-primary); }

/* Traços das ilustrações (compartilhados pelos SVGs dos slides) */
.lp-slide__svg { color: var(--lp-primary); }
.lp-art-body, .lp-art-card { fill: color-mix(in srgb, var(--color-background) 92%, var(--lp-primary) 8%); stroke: color-mix(in srgb, var(--color-foreground) 16%, transparent); stroke-width: 2; }
.lp-art-vane { fill: color-mix(in srgb, var(--lp-primary) 22%, transparent); }
.lp-art-line { fill: color-mix(in srgb, var(--color-foreground) 16%, transparent); }
.lp-art-accent { fill: var(--lp-primary); }
.lp-art-accent-soft { fill: color-mix(in srgb, var(--lp-primary) 26%, transparent); }
.lp-art-hole { fill: var(--color-background); stroke: color-mix(in srgb, var(--color-foreground) 16%, transparent); stroke-width: 2; }
.lp-art-check { fill: none; stroke: var(--lp-primary); stroke-width: 2.2; stroke-linecap: round; stroke-linejoin: round; }
.lp-art-check-lg { fill: none; stroke: var(--lp-primary); stroke-width: 7; stroke-linecap: round; stroke-linejoin: round; }
.lp-art-flow path, .lp-art-clean path { stroke: color-mix(in srgb, var(--lp-primary) 55%, transparent); stroke-width: 4; stroke-linecap: round; fill: none; }
.lp-art-arc { fill: none; stroke: var(--lp-primary); stroke-width: 6; stroke-linecap: round; }
.lp-art-arc-track { fill: none; stroke: color-mix(in srgb, var(--color-foreground) 12%, transparent); stroke-width: 6; stroke-linecap: round; }
.lp-art-needle { stroke: var(--lp-primary); stroke-width: 5; stroke-linecap: round; }
.lp-art-arrow { fill: none; stroke: var(--lp-primary); stroke-width: 4; stroke-linecap: round; stroke-linejoin: round; }
.lp-art-text { fill: color-mix(in srgb, var(--color-foreground) 55%, transparent); font-size: 11px; font-weight: 600; }
.lp-art-filter { stroke: color-mix(in srgb, var(--lp-primary) 45%, transparent); stroke-width: 3; stroke-linecap: round; }
.lp-art-dust { fill: color-mix(in srgb, var(--color-foreground) 26%, transparent); }
.lp-art-leaf { fill: color-mix(in srgb, var(--lp-primary) 40%, transparent); }
.lp-art-shield-edge { fill: none; stroke: var(--lp-primary); stroke-width: 3; }
.lp-art-muted-icon { fill: color-mix(in srgb, var(--color-foreground) 22%, transparent); }
.lp-art-alert { stroke: color-mix(in srgb, var(--color-foreground) 40%, transparent); stroke-width: 3; stroke-linecap: round; }
.lp-art-alert-dot { fill: color-mix(in srgb, var(--color-foreground) 40%, transparent); }
.lp-art-bar-high { fill: color-mix(in srgb, var(--color-foreground) 18%, transparent); }
.lp-art-axis { stroke: color-mix(in srgb, var(--color-foreground) 18%, transparent); stroke-width: 2.5; stroke-linecap: round; fill: none; }
/* Fluxo de ar: cinza na entrada (sujo), azul na saída (filtrado). */
.lp-art-dirty-flow path { fill: none; stroke: color-mix(in srgb, var(--color-foreground) 34%, transparent); stroke-width: 3.5; stroke-linecap: round; stroke-linejoin: round; }
.lp-art-clean-flow path { fill: none; stroke: color-mix(in srgb, var(--lp-primary) 65%, transparent); stroke-width: 3.5; stroke-linecap: round; stroke-linejoin: round; }
@media (prefers-reduced-motion: reduce) { .lp-carousel__track { transition: none; } }

/* Sections */
.lp-section { padding: 80px 0; }
.lp-section--muted { background: color-mix(in srgb, var(--color-foreground) 3.5%, transparent); }
/* Faixa fria: degradê azul suave para a seção não ficar toda branca. */
.lp-section--cool { background:
  linear-gradient(180deg, color-mix(in srgb, var(--lp-primary) 9%, transparent), transparent 62%),
  radial-gradient(70% 50% at 82% 8%, color-mix(in srgb, var(--lp-secondary) 10%, transparent), transparent 70%); }
.lp-section__head { max-width: 640px; margin: 0 auto 44px; text-align: center; }
.lp-eyebrow { display: inline-block; font-size: 13px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; color: var(--lp-primary); }
.lp-section__title { margin: 12px 0 0; font-size: clamp(1.6rem, 3vw, 2.2rem); font-weight: 800; letter-spacing: -0.02em; }
.lp-section__sub { margin: 14px 0 0; font-size: 1rem; line-height: 1.6; color: color-mix(in srgb, var(--color-foreground) 70%, transparent); }

/* Lados invertidos (texto à esquerda, imagem à direita) */
.lp-results--reverse .lp-collage { order: 2; }
.lp-about--reverse { grid-template-columns: .9fr 1.1fr; }
.lp-about--reverse .lp-about__stats { order: -1; }

/* Documentação: texto à esquerda, documentos em lista à direita */
.lp-docs { display: grid; grid-template-columns: 1fr 1fr; gap: 48px; align-items: center; }
.lp-docs .lp-signature-note { margin: 28px 0 0; max-width: none; }
.lp-docs__list { display: grid; gap: 16px; }
.lp-docs__list .lp-card { display: flex; align-items: flex-start; gap: 18px; padding: 22px; }
.lp-docs__list .lp-card:hover { transform: translateX(4px); }
.lp-docs__list .lp-card__icon { flex: none; }
.lp-docs__list .lp-card__title { margin: 2px 0 0; }

/* Grids & cards */
.lp-grid { display: grid; gap: 20px; }
.lp-grid--4 { grid-template-columns: repeat(4, 1fr); }
.lp-grid--3 { grid-template-columns: repeat(3, 1fr); }
/* Até 5 cards numa linha; com menos canais, os cards se expandem. */
.lp-grid--contact { grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); gap: 16px; }
.lp-card { padding: 26px; border-radius: 18px; background: var(--color-background); border: 1px solid color-mix(in srgb, var(--color-foreground) 9%, transparent); transition: transform .25s ease, box-shadow .25s ease, border-color .25s ease; }
.lp-card:hover { transform: translateY(-4px); box-shadow: 0 18px 40px color-mix(in srgb, var(--color-foreground) 10%, transparent); border-color: color-mix(in srgb, var(--lp-primary) 40%, transparent); }
.lp-card--report { background: color-mix(in srgb, var(--color-background) 100%, transparent); }
.lp-card__icon { display: inline-flex; align-items: center; justify-content: center; width: 48px; height: 48px; border-radius: 14px; color: var(--lp-primary); background: color-mix(in srgb, var(--lp-primary) 12%, transparent); }
.lp-card__title { margin: 16px 0 0; font-size: 1.12rem; font-weight: 700; }
.lp-card__text { margin: 8px 0 0; font-size: .95rem; line-height: 1.55; color: color-mix(in srgb, var(--color-foreground) 70%, transparent); }
.lp-signature-note { display: flex; align-items: center; gap: 12px; max-width: 760px; margin: 36px auto 0; padding: 16px 20px; border-radius: 14px; font-size: .95rem; color: var(--color-foreground); background: color-mix(in srgb, var(--lp-primary) 8%, transparent); border: 1px solid color-mix(in srgb, var(--lp-primary) 22%, transparent); }
.lp-signature-note svg { color: var(--lp-primary); flex: none; }

/* About */
.lp-about { display: grid; grid-template-columns: 1.1fr .9fr; gap: 48px; align-items: center; }
.lp-checklist { list-style: none; padding: 0; margin: 24px 0 0; display: grid; gap: 12px; }
.lp-checklist li { display: flex; align-items: center; gap: 10px; font-size: .98rem; }
.lp-checklist svg { color: var(--lp-primary); flex: none; }
.lp-about__stats { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
.lp-stat { padding: 22px; border-radius: 16px; background: color-mix(in srgb, var(--lp-primary) 7%, transparent); border: 1px solid color-mix(in srgb, var(--lp-primary) 15%, transparent); }
.lp-stat strong { display: block; font-size: 1.15rem; font-weight: 800; color: var(--lp-primary); }
.lp-stat span { display: block; margin-top: 6px; font-size: .9rem; color: color-mix(in srgb, var(--lp-primary) 55%, var(--color-foreground)); }

/* Contact */
.lp-contact { display: flex; flex-direction: column; gap: 6px; padding: 20px; border-radius: 18px; min-width: 0; text-decoration: none; color: var(--color-foreground); background: var(--color-background); border: 1px solid color-mix(in srgb, var(--color-foreground) 10%, transparent); transition: transform .25s ease, box-shadow .25s ease, border-color .25s ease; }
.lp-contact:is(a):hover { transform: translateY(-4px); box-shadow: 0 18px 40px color-mix(in srgb, var(--color-foreground) 10%, transparent); border-color: color-mix(in srgb, var(--lp-primary) 40%, transparent); }
.lp-contact__icon { display: inline-flex; align-items: center; justify-content: center; width: 42px; height: 42px; border-radius: 12px; color: var(--lp-primary); background: color-mix(in srgb, var(--lp-primary) 12%, transparent); margin-bottom: 6px; }
.lp-contact__label { font-size: 13px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; color: color-mix(in srgb, var(--color-foreground) 55%, transparent); }
.lp-contact__value { font-size: .98rem; font-weight: 600; overflow-wrap: anywhere; }
.lp-contact__value--email { font-size: .92rem; }
.lp-contact__value--handle { overflow-wrap: normal; }
/* Números (1 ou 2) dentro do card de WhatsApp/Telefone, cada um clicável. */
.lp-contact__lines { display: flex; flex-direction: column; gap: 6px; margin-top: 2px; }
.lp-contact__line { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 8px 10px; margin: 0 -10px; border-radius: 10px;
  color: inherit; text-decoration: none; transition: background .2s ease; }
.lp-contact__line:hover { background: color-mix(in srgb, var(--lp-primary) 8%, transparent); }
.lp-contact__line svg { flex: none; color: var(--lp-primary); }
.lp-contact__line-main { display: flex; flex-direction: column; min-width: 0; }
.lp-contact__line-main strong { font-size: .98rem; white-space: nowrap; }
.lp-contact__line-main small { font-size: .78rem; color: color-mix(in srgb, var(--color-foreground) 58%, transparent); overflow-wrap: anywhere; }
.lp-contact--primary .lp-contact__line:hover { background: rgba(255, 255, 255, .14); }
.lp-contact--primary .lp-contact__line svg { color: #fff; }
.lp-contact--primary .lp-contact__line-main small { color: rgba(255, 255, 255, .78); }
.lp-contact__cta { display: inline-flex; align-items: center; gap: 6px; margin-top: 6px; font-size: .9rem; font-weight: 600; color: var(--lp-primary); }
.lp-contact__cta--static { color: color-mix(in srgb, var(--color-foreground) 55%, transparent); }
.lp-contact--primary { background: var(--lp-primary); border-color: var(--lp-primary); color: #fff; box-shadow: 0 14px 34px color-mix(in srgb, var(--lp-primary) 34%, transparent); }
.lp-contact--primary .lp-contact__icon { background: rgba(255,255,255,.18); color: #fff; }
.lp-contact--primary .lp-contact__label, .lp-contact--primary .lp-contact__cta { color: rgba(255,255,255,.9); }

/* Avatar com iniciais do responsável (menu do botão flutuante de WhatsApp) */
.lp-person__avatar { flex: none; display: inline-flex; align-items: center; justify-content: center; width: 52px; height: 52px; border-radius: 50%;
  font-size: 1.05rem; font-weight: 800; letter-spacing: .02em; color: #fff;
  background: linear-gradient(135deg, var(--lp-primary), var(--lp-secondary)); }
.lp-person__avatar--sm { width: 38px; height: 38px; font-size: .85rem; }

/* Instagram: degradê da marca só no ícone, para não brigar com a paleta da empresa */
.lp-ig-btn { flex: none; display: inline-flex; align-items: center; justify-content: center; border-radius: 50%; color: #fff; text-decoration: none;
  background: radial-gradient(circle at 30% 107%, #fdf497 0%, #fdf497 5%, #fd5949 45%, #d6249f 60%, #285aeb 90%);
  box-shadow: 0 6px 16px rgba(214, 36, 159, .3); transition: transform .15s ease, box-shadow .2s ease; }
.lp-ig-btn:hover { transform: translateY(-1px) scale(1.05); box-shadow: 0 10px 22px rgba(214, 36, 159, .4); }
.lp-ig-btn--sm { width: 28px; height: 28px; box-shadow: none; }
.lp-contact--instagram .lp-contact__icon { color: #fff; background: radial-gradient(circle at 30% 107%, #fdf497 0%, #fdf497 5%, #fd5949 45%, #d6249f 60%, #285aeb 90%); }
.lp-results__content .lp-hero__cta { margin-top: 0; }
.lp-footer__social { display: inline-flex; align-items: center; gap: 8px; margin-top: 10px; font-size: .9rem; font-weight: 600; color: var(--color-foreground); text-decoration: none; }
.lp-footer__social:hover { color: var(--lp-primary); }

/* Footer */
.lp-footer { padding: 44px 0; border-top: 1px solid color-mix(in srgb, var(--color-foreground) 10%, transparent); }
.lp-footer__inner { display: flex; flex-wrap: wrap; gap: 24px; align-items: center; justify-content: space-between; }
.lp-footer__brand p { margin: 8px 0 0; font-size: .88rem; color: color-mix(in srgb, var(--color-foreground) 60%, transparent); }
.lp-footer__links { display: flex; flex-wrap: wrap; gap: 18px; }
.lp-footer__links a { font-size: .92rem; color: color-mix(in srgb, var(--color-foreground) 72%, transparent); text-decoration: none; }
.lp-footer__links a:hover { color: var(--lp-primary); }
.lp-footer__link-btn { padding: 0; border: 0; background: none; cursor: pointer; font: inherit; font-size: .92rem;
  color: color-mix(in srgb, var(--color-foreground) 72%, transparent); }
.lp-footer__link-btn:hover { color: var(--lp-primary); }
.lp-footer__meta { display: flex; flex-direction: column; gap: 4px; text-align: right; font-size: .82rem; color: color-mix(in srgb, var(--color-foreground) 55%, transparent); }
.lp-footer__meta a { color: var(--lp-primary); text-decoration: none; }

/* WhatsApp flutuante */
.lp-fab-wrap { position: fixed; right: 22px; bottom: 22px; z-index: 60; display: flex; flex-direction: column; align-items: flex-end; gap: 12px; }
.lp-fab-wrap .lp-fab { position: relative; right: auto; bottom: auto; border: 0; cursor: pointer; }
.lp-fab-menu { display: flex; flex-direction: column; gap: 4px; min-width: 240px; padding: 10px; border-radius: 16px; background: var(--color-background);
  border: 1px solid color-mix(in srgb, var(--color-foreground) 10%, transparent); box-shadow: 0 18px 44px rgba(8, 15, 30, .28); animation: lp-fab-in .2s ease both; }
.lp-fab-menu__title { padding: 4px 8px 6px; font-size: 12px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; color: color-mix(in srgb, var(--color-foreground) 55%, transparent); }
.lp-fab-menu__item { display: flex; align-items: center; gap: 10px; padding: 8px; border-radius: 12px; color: var(--color-foreground); text-decoration: none; }
.lp-fab-menu__item:hover { background: color-mix(in srgb, #25d366 12%, transparent); }
.lp-fab-menu__text { display: flex; flex-direction: column; line-height: 1.2; }
.lp-fab-menu__text strong { font-size: .95rem; }
.lp-fab-menu__text span { font-size: .8rem; color: color-mix(in srgb, var(--color-foreground) 60%, transparent); }
.lp-fab { position: fixed; right: 22px; bottom: 22px; z-index: 60; display: inline-flex; align-items: center; justify-content: center; width: 58px; height: 58px; border-radius: 50%; background: #25d366; color: #fff; box-shadow: 0 10px 28px rgba(37,211,102,.45); transition: transform .2s ease, box-shadow .2s ease; animation: lp-fab-in .4s ease both; }
.lp-fab:hover { transform: translateY(-2px) scale(1.05); box-shadow: 0 14px 34px rgba(37,211,102,.55); }
.lp-fab::after { content: ""; position: absolute; inset: 0; border-radius: 50%; box-shadow: 0 0 0 0 rgba(37,211,102,.5); animation: lp-fab-pulse 2.4s ease-out infinite; }
@keyframes lp-fab-in { from { opacity: 0; transform: translateY(12px) scale(.85); } to { opacity: 1; transform: none; } }
@keyframes lp-fab-pulse { 0% { box-shadow: 0 0 0 0 rgba(37,211,102,.45); } 70% { box-shadow: 0 0 0 16px rgba(37,211,102,0); } 100% { box-shadow: 0 0 0 0 rgba(37,211,102,0); } }
@media (prefers-reduced-motion: reduce) { .lp-fab, .lp-fab::after { animation: none; } }

/* Anchor offset */
#servicos, #resultados, #clientes, #preventiva, #empresa, #relatorios, #contato, #inicio { scroll-margin-top: 84px; }

/* Responsive */
@media (max-width: 940px) {
  .lp-about, .lp-about--reverse { grid-template-columns: 1fr; gap: 32px; }
  .lp-about--reverse .lp-about__stats { order: 0; }
  .lp-results--reverse .lp-collage { order: -1; }
  .lp-docs { grid-template-columns: 1fr; gap: 32px; }
  .lp-grid--4 { grid-template-columns: repeat(2, 1fr); }
  .lp-grid--contact { grid-template-columns: repeat(2, 1fr); }
  .lp-svc-grid { grid-template-columns: repeat(2, 1fr); }
  .lp-benefits { grid-template-columns: repeat(2, 1fr); }
  .lp-results { grid-template-columns: 1fr; gap: 40px; }
  .lp-collage { max-width: 520px; margin: 0 auto; }
  .lp-slide { grid-template-columns: 1fr; gap: 28px; padding: 40px 32px; min-height: 0; text-align: center; }
  .lp-slide__art { order: -1; }
  .lp-slide__svg { max-width: 300px; }
  .lp-carousel__nav--prev { left: 8px; }
  .lp-carousel__nav--next { right: 8px; }
}
@media (max-width: 720px) {
  .lp-nav, .lp-hide-sm { display: none; }
  .lp-svc-grid { grid-template-columns: 1fr; }
  .lp-menu-btn { display: inline-flex; }
  .lp-mobile-menu { display: flex; }
  .lp-grid--3 { grid-template-columns: 1fr; }
  .lp-section { padding: 60px 0; }
  .lp-hero { padding: 28px 0 60px; }
  .lp-ac { max-width: 360px; }
  .lp-mark { margin: 22px auto 22px; }
}
@media (max-width: 480px) {
  .lp-grid--4, .lp-grid--contact { grid-template-columns: 1fr; }
  .lp-benefits { grid-template-columns: 1fr; }
  .lp-metrics { grid-template-columns: 1fr; }
  .lp-collage { min-height: 320px; }
  .lp-collage__seal { right: 0; bottom: 6%; padding: 10px 13px; }
  .lp-about__stats { grid-template-columns: 1fr; }
  .lp-footer__inner { flex-direction: column; align-items: flex-start; }
  .lp-footer__meta { text-align: left; }
}
`;
