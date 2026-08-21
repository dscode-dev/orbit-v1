"use client";

/**
 * Landing page pública da Climatize (cartão de visita + canal de contato).
 *
 * Página única com navegação por âncoras (#servicos, #relatorios, #empresa,
 * #contato) e efeito de reveal ao rolar (IntersectionObserver + CSS — sem
 * dependências novas). Consome apenas o endpoint público
 * `GET /organization/public`, que expõe somente dados de vitrine e contato.
 *
 * O botão "Gestão" leva à tela de login da plataforma (/login).
 */
import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  ArrowRight,
  ClipboardCheck,
  FileSignature,
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
import { organizationApi, type PublicCompanyProfile } from "@erp/api";

const WHATSAPP_MESSAGE =
  "Olá! Vim pelo site e gostaria de saber mais sobre os serviços de climatização e refrigeração.";

const NAV = [
  { href: "#servicos", label: "Serviços" },
  { href: "#relatorios", label: "Documentação" },
  { href: "#empresa", label: "A empresa" },
  { href: "#contato", label: "Contato" },
];

const SERVICES = [
  {
    icon: ShieldCheck,
    title: "Manutenção Preventiva",
    text: "Planos periódicos que prolongam a vida útil dos equipamentos, garantem eficiência energética e conformidade com a Lei 13.589/2018 (PMOC).",
  },
  {
    icon: Wrench,
    title: "Manutenção Corretiva",
    text: "Diagnóstico e reparo ágil de falhas em sistemas de climatização e refrigeração, com peças e procedimentos rastreáveis.",
  },
  {
    icon: Wind,
    title: "Instalação",
    text: "Dimensionamento e instalação de equipamentos de ar-condicionado e refrigeração, executados dentro das normas técnicas.",
  },
  {
    icon: Settings2,
    title: "Projetos & Consultoria",
    text: "Projetos de climatização e soluções sob medida para ambientes comerciais, industriais e residenciais.",
  },
];

const REPORTS = [
  {
    icon: ClipboardCheck,
    title: "PMOC",
    text: "Plano de Manutenção, Operação e Controle emitido e acompanhado de forma totalmente digital.",
  },
  {
    icon: FileSignature,
    title: "Relatório de Visita Técnica",
    text: "Registro completo de cada atendimento em campo, com evidências e assinatura no ato.",
  },
  {
    icon: ClipboardCheck,
    title: "Ordem de Serviço",
    text: "Escopo, execução e materiais documentados em uma OS clara e auditável.",
  },
];

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

  const name = company?.name ?? "Climatize";
  const segment = company?.segment ?? "HVAC-R";
  const email = company?.email ?? null;
  const phone = company?.phones?.[0] ?? null;
  const website = company?.website ?? null;
  const location = useMemo(() => {
    if (!company?.city) return null;
    return company.state ? `${company.city} · ${company.state}` : company.city;
  }, [company]);

  const whatsappUrl = company?.whatsapp
    ? `https://wa.me/${company.whatsapp}?text=${encodeURIComponent(WHATSAPP_MESSAGE)}`
    : null;

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
            <BrandLogo height={34} alt={name} />
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
      <section id="inicio" className="lp-hero">
        <div className="lp-hero__glow" aria-hidden />
        <div className="lp-container lp-hero__inner">
          <div className="lp-hero__content" data-reveal>
            <span className="lp-badge">
              <Snowflake size={14} /> Segmento {segment}
            </span>
            <h1 className="lp-hero__title">
              Climatização e refrigeração com <span className="lp-accent">excelência técnica</span>.
            </h1>
            <p className="lp-hero__lead">
              A {name} cuida da manutenção, instalação e do desempenho dos seus equipamentos de
              refrigeração — com documentação técnica <strong>100% digital</strong> e assinada por
              responsável técnico credenciado.
            </p>
            <div className="lp-hero__cta">
              {whatsappUrl && (
                <a
                  href={whatsappUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="lp-btn lp-btn--primary lp-btn--lg"
                >
                  <MessageCircle size={18} /> Falar no WhatsApp
                </a>
              )}
              <a href="#servicos" className="lp-btn lp-btn--outline lp-btn--lg">
                Ver serviços <ArrowRight size={18} />
              </a>
            </div>
            <ul className="lp-hero__facts">
              <li>
                <strong>Preventiva & PMOC</strong>
                <span>Conformidade legal</span>
              </li>
              <li>
                <strong>Instalação</strong>
                <span>Dentro das normas</span>
              </li>
              <li>
                <strong>Relatórios assinados</strong>
                <span>Responsável técnico</span>
              </li>
            </ul>
          </div>

          <div className="lp-hero__visual" data-reveal>
            <div className="lp-hero__card">
              <BrandLogo height={52} alt={name} />
              <div className="lp-hero__card-grid">
                {[
                  { icon: Wind, label: "Ar-condicionado" },
                  { icon: Snowflake, label: "Refrigeração" },
                  { icon: ShieldCheck, label: "Preventiva" },
                  { icon: FileSignature, label: "Laudos digitais" },
                ].map(({ icon: Icon, label }) => (
                  <div key={label} className="lp-chip">
                    <Icon size={18} />
                    <span>{label}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ---------- Serviços ---------- */}
      <section id="servicos" className="lp-section">
        <div className="lp-container">
          <header className="lp-section__head" data-reveal>
            <span className="lp-eyebrow">O que fazemos</span>
            <h2 className="lp-section__title">Serviços em climatização e refrigeração</h2>
            <p className="lp-section__sub">
              Do atendimento pontual ao contrato de manutenção contínua, cobrindo todo o ciclo de
              vida dos seus equipamentos.
            </p>
          </header>
          <div className="lp-grid lp-grid--4">
            {SERVICES.map(({ icon: Icon, title, text }, i) => (
              <article key={title} className="lp-card" data-reveal style={{ transitionDelay: `${i * 60}ms` }}>
                <span className="lp-card__icon">
                  <Icon size={22} />
                </span>
                <h3 className="lp-card__title">{title}</h3>
                <p className="lp-card__text">{text}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* ---------- Documentação / Relatórios ---------- */}
      <section id="relatorios" className="lp-section lp-section--muted">
        <div className="lp-container">
          <header className="lp-section__head" data-reveal>
            <span className="lp-eyebrow">Documentação técnica</span>
            <h2 className="lp-section__title">Relatórios digitais, assinados e auditáveis</h2>
            <p className="lp-section__sub">
              Cada serviço gera documentação profissional emitida de forma totalmente digital e
              assinada por responsável técnico credenciado.
            </p>
          </header>
          <div className="lp-grid lp-grid--3">
            {REPORTS.map(({ icon: Icon, title, text }, i) => (
              <article key={title} className="lp-card lp-card--report" data-reveal style={{ transitionDelay: `${i * 60}ms` }}>
                <span className="lp-card__icon">
                  <Icon size={22} />
                </span>
                <h3 className="lp-card__title">{title}</h3>
                <p className="lp-card__text">{text}</p>
              </article>
            ))}
          </div>
          <div className="lp-signature-note" data-reveal>
            <FileSignature size={18} />
            <span>
              Todos os documentos são assinados digitalmente pelo responsável técnico — validade,
              rastreabilidade e transparência em cada atendimento.
            </span>
          </div>
        </div>
      </section>

      {/* ---------- A empresa ---------- */}
      <section id="empresa" className="lp-section">
        <div className="lp-container lp-about">
          <div className="lp-about__text" data-reveal>
            <span className="lp-eyebrow">A empresa</span>
            <h2 className="lp-section__title">Especialistas em {segment}</h2>
            <p className="lp-section__sub">
              A {name} atua com ventilação, ar-condicionado e refrigeração, entregando
              soluções confiáveis para clientes residenciais, comerciais e industriais. Nosso
              compromisso é unir execução técnica de qualidade a uma gestão transparente e
              documentada.
            </p>
            <ul className="lp-checklist">
              {[
                "Equipe técnica qualificada e responsável credenciado",
                "Processos padronizados e rastreáveis",
                "Atendimento ágil e comunicação clara",
                "Conformidade com as normas do setor",
              ].map((item) => (
                <li key={item}>
                  <ShieldCheck size={18} /> {item}
                </li>
              ))}
            </ul>
          </div>
          <div className="lp-about__stats" data-reveal>
            {[
              { k: segment, v: "Segmento de atuação" },
              { k: "100% digital", v: "Documentação técnica" },
              { k: "PMOC · RVT · OS", v: "Relatórios assinados" },
              { k: "Preventiva", v: "Foco em eficiência" },
            ].map((s) => (
              <div key={s.v} className="lp-stat">
                <strong>{s.k}</strong>
                <span>{s.v}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ---------- Contato ---------- */}
      <section id="contato" className="lp-section lp-section--muted">
        <div className="lp-container">
          <header className="lp-section__head" data-reveal>
            <span className="lp-eyebrow">Fale com a gente</span>
            <h2 className="lp-section__title">Vamos climatizar o seu ambiente</h2>
            <p className="lp-section__sub">
              Solicite um orçamento ou tire suas dúvidas pelos canais abaixo.
            </p>
          </header>

          <div className="lp-grid lp-grid--contact">
            {whatsappUrl && (
              <a
                href={whatsappUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="lp-contact lp-contact--primary"
                data-reveal
              >
                <span className="lp-contact__icon">
                  <MessageCircle size={22} />
                </span>
                <span className="lp-contact__label">WhatsApp</span>
                <span className="lp-contact__value">{phone ?? "Enviar mensagem"}</span>
                <span className="lp-contact__cta">
                  Iniciar conversa <ArrowRight size={15} />
                </span>
              </a>
            )}

            {email && (
              <a href={`mailto:${email}`} className="lp-contact" data-reveal>
                <span className="lp-contact__icon">
                  <Mail size={22} />
                </span>
                <span className="lp-contact__label">E-mail</span>
                <span className="lp-contact__value">{email}</span>
                <span className="lp-contact__cta">
                  Enviar e-mail <ArrowRight size={15} />
                </span>
              </a>
            )}

            {phone && (
              <a href={`tel:${phone.replace(/[^\d+]/g, "")}`} className="lp-contact" data-reveal>
                <span className="lp-contact__icon">
                  <Phone size={22} />
                </span>
                <span className="lp-contact__label">Telefone</span>
                <span className="lp-contact__value">{phone}</span>
                <span className="lp-contact__cta">
                  Ligar agora <ArrowRight size={15} />
                </span>
              </a>
            )}

            {location && (
              <div className="lp-contact" data-reveal>
                <span className="lp-contact__icon">
                  <MapPin size={22} />
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
          </div>
          <div className="lp-footer__links">
            {NAV.map((item) => (
              <a key={item.href} href={item.href}>
                {item.label}
              </a>
            ))}
            <Link href="/login">Acesso à gestão</Link>
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
      {whatsappUrl && (
        <a
          href={whatsappUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="lp-fab"
          aria-label="Falar no WhatsApp"
        >
          <svg viewBox="0 0 32 32" width="30" height="30" fill="currentColor" aria-hidden>
            <path d="M16.003 3.2c-7.06 0-12.8 5.74-12.8 12.8 0 2.257.594 4.454 1.72 6.395L3.2 28.8l6.57-1.717a12.74 12.74 0 0 0 6.23 1.62h.005c7.06 0 12.8-5.74 12.8-12.8 0-3.42-1.332-6.635-3.75-9.053A12.72 12.72 0 0 0 16.003 3.2zm0 2.133a10.63 10.63 0 0 1 7.548 3.126 10.6 10.6 0 0 1 3.12 7.542c0 5.884-4.786 10.667-10.67 10.667a10.62 10.62 0 0 1-5.41-1.48l-.388-.23-4.03 1.053 1.076-3.926-.253-.403a10.6 10.6 0 0 1-1.626-5.68c0-5.883 4.786-10.666 10.67-10.666zm-5.87 5.744c-.196 0-.514.074-.784.37-.27.294-1.03 1.006-1.03 2.452 0 1.446 1.055 2.843 1.202 3.04.147.196 2.076 3.17 5.03 4.446.703.303 1.25.485 1.678.62.705.224 1.346.192 1.853.117.565-.084 1.74-.712 1.986-1.4.245-.686.245-1.274.172-1.4-.074-.123-.27-.196-.564-.343-.294-.147-1.74-.858-2.01-.956-.27-.098-.466-.147-.662.148-.196.294-.76.955-.93 1.15-.172.197-.343.222-.637.075-.294-.148-1.24-.457-2.363-1.458-.873-.778-1.463-1.74-1.634-2.034-.17-.294-.018-.453.13-.6.132-.132.294-.343.44-.514.148-.172.196-.294.294-.49.098-.197.05-.368-.025-.515-.074-.147-.646-1.6-.91-2.18-.235-.516-.474-.447-.662-.456l-.564-.01z"/>
          </svg>
        </a>
      )}
    </div>
  );
}

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

/* Hero */
.lp-hero { position: relative; padding: 72px 0 80px; overflow: clip; }
.lp-hero__glow { position: absolute; inset: -20% 0 auto; height: 620px; background:
  radial-gradient(600px 320px at 22% 12%, color-mix(in srgb, var(--lp-primary) 24%, transparent), transparent 70%),
  radial-gradient(520px 300px at 88% 8%, color-mix(in srgb, var(--lp-secondary) 20%, transparent), transparent 70%);
  pointer-events: none; }
.lp-hero__inner { position: relative; display: grid; grid-template-columns: 1.15fr .85fr; gap: 48px; align-items: center; }
.lp-badge { display: inline-flex; align-items: center; gap: 7px; padding: 6px 12px; border-radius: 999px; font-size: 13px; font-weight: 600; color: var(--lp-primary); background: color-mix(in srgb, var(--lp-primary) 12%, transparent); border: 1px solid color-mix(in srgb, var(--lp-primary) 22%, transparent); }
.lp-hero__title { margin: 18px 0 0; font-size: clamp(2.1rem, 4.6vw, 3.4rem); line-height: 1.06; font-weight: 800; letter-spacing: -0.02em; }
.lp-accent { background: linear-gradient(100deg, var(--lp-primary), var(--lp-secondary)); -webkit-background-clip: text; background-clip: text; color: transparent; }
.lp-hero__lead { margin: 20px 0 0; font-size: clamp(1rem, 1.6vw, 1.15rem); line-height: 1.6; color: color-mix(in srgb, var(--color-foreground) 74%, transparent); max-width: 44ch; }
.lp-hero__cta { display: flex; flex-wrap: wrap; gap: 12px; margin-top: 28px; }
.lp-hero__facts { list-style: none; display: flex; flex-wrap: wrap; gap: 28px; margin: 36px 0 0; padding: 0; }
.lp-hero__facts li { display: flex; flex-direction: column; }
.lp-hero__facts strong { font-size: 15px; }
.lp-hero__facts span { font-size: 13px; color: color-mix(in srgb, var(--color-foreground) 60%, transparent); }
.lp-hero__visual { display: flex; justify-content: center; }
.lp-hero__card { width: 100%; max-width: 380px; padding: 28px; border-radius: 22px; background: color-mix(in srgb, var(--color-foreground) 4%, transparent); border: 1px solid color-mix(in srgb, var(--color-foreground) 10%, transparent); box-shadow: 0 24px 60px color-mix(in srgb, var(--lp-primary) 14%, transparent); backdrop-filter: blur(6px); }
.lp-hero__card-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-top: 22px; }
.lp-chip { display: flex; align-items: center; gap: 10px; padding: 14px; border-radius: 14px; font-size: 14px; font-weight: 500; background: color-mix(in srgb, var(--lp-primary) 8%, transparent); border: 1px solid color-mix(in srgb, var(--lp-primary) 16%, transparent); color: color-mix(in srgb, var(--lp-primary) 72%, var(--color-foreground)); }
.lp-chip svg { color: var(--lp-primary); }

/* Sections */
.lp-section { padding: 80px 0; }
.lp-section--muted { background: color-mix(in srgb, var(--color-foreground) 3.5%, transparent); }
.lp-section__head { max-width: 640px; margin: 0 auto 44px; text-align: center; }
.lp-eyebrow { display: inline-block; font-size: 13px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; color: var(--lp-primary); }
.lp-section__title { margin: 12px 0 0; font-size: clamp(1.6rem, 3vw, 2.2rem); font-weight: 800; letter-spacing: -0.02em; }
.lp-section__sub { margin: 14px 0 0; font-size: 1rem; line-height: 1.6; color: color-mix(in srgb, var(--color-foreground) 70%, transparent); }

/* Grids & cards */
.lp-grid { display: grid; gap: 20px; }
.lp-grid--4 { grid-template-columns: repeat(4, 1fr); }
.lp-grid--3 { grid-template-columns: repeat(3, 1fr); }
.lp-grid--contact { grid-template-columns: repeat(4, 1fr); }
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
.lp-contact { display: flex; flex-direction: column; gap: 6px; padding: 24px; border-radius: 18px; text-decoration: none; color: var(--color-foreground); background: var(--color-background); border: 1px solid color-mix(in srgb, var(--color-foreground) 10%, transparent); transition: transform .25s ease, box-shadow .25s ease, border-color .25s ease; }
.lp-contact:hover { transform: translateY(-4px); box-shadow: 0 18px 40px color-mix(in srgb, var(--color-foreground) 10%, transparent); border-color: color-mix(in srgb, var(--lp-primary) 40%, transparent); }
.lp-contact__icon { display: inline-flex; align-items: center; justify-content: center; width: 48px; height: 48px; border-radius: 14px; color: var(--lp-primary); background: color-mix(in srgb, var(--lp-primary) 12%, transparent); margin-bottom: 6px; }
.lp-contact__label { font-size: 13px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; color: color-mix(in srgb, var(--color-foreground) 55%, transparent); }
.lp-contact__value { font-size: 1rem; font-weight: 600; word-break: break-word; }
.lp-contact__cta { display: inline-flex; align-items: center; gap: 6px; margin-top: 6px; font-size: .9rem; font-weight: 600; color: var(--lp-primary); }
.lp-contact__cta--static { color: color-mix(in srgb, var(--color-foreground) 55%, transparent); }
.lp-contact--primary { background: var(--lp-primary); border-color: var(--lp-primary); color: #fff; box-shadow: 0 14px 34px color-mix(in srgb, var(--lp-primary) 34%, transparent); }
.lp-contact--primary .lp-contact__icon { background: rgba(255,255,255,.18); color: #fff; }
.lp-contact--primary .lp-contact__label, .lp-contact--primary .lp-contact__cta { color: rgba(255,255,255,.9); }

/* Footer */
.lp-footer { padding: 44px 0; border-top: 1px solid color-mix(in srgb, var(--color-foreground) 10%, transparent); }
.lp-footer__inner { display: flex; flex-wrap: wrap; gap: 24px; align-items: center; justify-content: space-between; }
.lp-footer__brand p { margin: 8px 0 0; font-size: .88rem; color: color-mix(in srgb, var(--color-foreground) 60%, transparent); }
.lp-footer__links { display: flex; flex-wrap: wrap; gap: 18px; }
.lp-footer__links a { font-size: .92rem; color: color-mix(in srgb, var(--color-foreground) 72%, transparent); text-decoration: none; }
.lp-footer__links a:hover { color: var(--lp-primary); }
.lp-footer__meta { display: flex; flex-direction: column; gap: 4px; text-align: right; font-size: .82rem; color: color-mix(in srgb, var(--color-foreground) 55%, transparent); }
.lp-footer__meta a { color: var(--lp-primary); text-decoration: none; }

/* WhatsApp flutuante */
.lp-fab { position: fixed; right: 22px; bottom: 22px; z-index: 60; display: inline-flex; align-items: center; justify-content: center; width: 58px; height: 58px; border-radius: 50%; background: #25d366; color: #fff; box-shadow: 0 10px 28px rgba(37,211,102,.45); transition: transform .2s ease, box-shadow .2s ease; animation: lp-fab-in .4s ease both; }
.lp-fab:hover { transform: translateY(-2px) scale(1.05); box-shadow: 0 14px 34px rgba(37,211,102,.55); }
.lp-fab::after { content: ""; position: absolute; inset: 0; border-radius: 50%; box-shadow: 0 0 0 0 rgba(37,211,102,.5); animation: lp-fab-pulse 2.4s ease-out infinite; }
@keyframes lp-fab-in { from { opacity: 0; transform: translateY(12px) scale(.85); } to { opacity: 1; transform: none; } }
@keyframes lp-fab-pulse { 0% { box-shadow: 0 0 0 0 rgba(37,211,102,.45); } 70% { box-shadow: 0 0 0 16px rgba(37,211,102,0); } 100% { box-shadow: 0 0 0 0 rgba(37,211,102,0); } }
@media (prefers-reduced-motion: reduce) { .lp-fab, .lp-fab::after { animation: none; } }

/* Anchor offset */
#servicos, #relatorios, #empresa, #contato, #inicio { scroll-margin-top: 84px; }

/* Responsive */
@media (max-width: 940px) {
  .lp-hero__inner { grid-template-columns: 1fr; gap: 36px; }
  .lp-hero__visual { order: -1; }
  .lp-about { grid-template-columns: 1fr; gap: 32px; }
  .lp-grid--4 { grid-template-columns: repeat(2, 1fr); }
  .lp-grid--contact { grid-template-columns: repeat(2, 1fr); }
}
@media (max-width: 720px) {
  .lp-nav, .lp-hide-sm { display: none; }
  .lp-menu-btn { display: inline-flex; }
  .lp-mobile-menu { display: flex; }
  .lp-grid--3 { grid-template-columns: 1fr; }
  .lp-section { padding: 60px 0; }
  .lp-hero { padding: 48px 0 60px; }
}
@media (max-width: 480px) {
  .lp-grid--4, .lp-grid--contact { grid-template-columns: 1fr; }
  .lp-about__stats { grid-template-columns: 1fr; }
  .lp-footer__inner { flex-direction: column; align-items: flex-start; }
  .lp-footer__meta { text-align: left; }
}
`;
