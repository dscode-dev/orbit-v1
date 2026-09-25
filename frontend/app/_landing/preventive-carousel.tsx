"use client";

/**
 * Carrossel "Benefícios da manutenção preventiva" da landing.
 *
 * Cada slide tem título, ilustração (SVG puro, sem imagem) e uma descrição
 * curta. Navegação por setas, indicadores e teclado; avanço automático que
 * pausa no hover/foco e é desligado com `prefers-reduced-motion`.
 * O estilo usa as mesmas variáveis/classes (`lp-*`) do restante da landing.
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

const AUTOPLAY_MS = 7000;

type Benefit = { key: string; title: string; text: string; art: ReactNode };

/* ---------- Ilustrações (SVG) ---------- */

const artProps = { viewBox: "0 0 240 180", className: "lp-slide__svg", role: "presentation" } as const;

function ArtOverview() {
  return (
    <svg {...artProps}>
      {/* split + checklist de procedimentos */}
      <rect x="18" y="34" width="120" height="44" rx="12" className="lp-art-body" />
      <rect x="30" y="46" width="96" height="4" rx="2" className="lp-art-line" />
      <rect x="30" y="56" width="96" height="4" rx="2" className="lp-art-line" />
      <path d="M26 78 H130 l-8 12 H34 Z" className="lp-art-vane" />
      <g className="lp-art-flow">
        <path d="M46 98 v16" /><path d="M78 98 v24" /><path d="M110 98 v16" />
      </g>
      <rect x="150" y="30" width="74" height="112" rx="12" className="lp-art-card" />
      <rect x="162" y="44" width="34" height="5" rx="2.5" className="lp-art-line" />
      {[0, 1, 2, 3].map((i) => (
        <g key={i}>
          <circle cx="168" cy={68 + i * 20} r="7" className="lp-art-accent-soft" />
          <path d={`M164.5 ${68 + i * 20} l2.5 2.5 l5 -5`} className="lp-art-check" />
          <rect x="182" y={65 + i * 20} width="30" height="5" rx="2.5" className="lp-art-line" />
        </g>
      ))}
    </svg>
  );
}

function ArtEnergy() {
  return (
    <svg {...artProps}>
      {/* medidor de consumo com ponteiro na faixa econômica */}
      <path d="M40 130 A68 68 0 0 1 176 130" className="lp-art-arc-track" />
      <path d="M40 130 A68 68 0 0 1 84 68" className="lp-art-arc" />
      <circle cx="108" cy="130" r="9" className="lp-art-accent" />
      <path d="M108 130 L78 84" className="lp-art-needle" />
      <text x="36" y="148" className="lp-art-text">min</text>
      <text x="162" y="148" className="lp-art-text">máx</text>
      {/* raio + seta de queda */}
      <path d="M196 44 l-16 30 h12 l-8 26 22 -34 h-12 z" className="lp-art-accent" />
      <path d="M204 118 v22 m0 0 l-7 -7 m7 7 l7 -7" className="lp-art-arrow" />
    </svg>
  );
}

function ArtLifespan() {
  return (
    <svg {...artProps}>
      {/* engrenagem + curva de vida útil crescente */}
      <g className="lp-art-gear">
        <circle cx="62" cy="88" r="30" className="lp-art-accent-soft" />
        <circle cx="62" cy="88" r="13" className="lp-art-hole" />
        {Array.from({ length: 8 }).map((_, i) => (
          <rect
            key={i}
            x="57"
            y="50"
            width="10"
            height="12"
            rx="3"
            className="lp-art-accent"
            transform={`rotate(${i * 45} 62 88)`}
          />
        ))}
      </g>
      <path d="M118 136 L150 112 L176 120 L214 66" className="lp-art-arc" />
      <circle cx="214" cy="66" r="7" className="lp-art-accent" />
      {[0, 1, 2, 3].map((i) => (
        <rect key={i} x={118 + i * 26} y={144} width="16" height="6" rx="3" className="lp-art-line" />
      ))}
    </svg>
  );
}

function ArtAirQuality() {
  // Leitura da esquerda para a direita: ar sujo entra, o filtro retém a sujeira,
  // ar limpo sai. As legendas evitam que a cena vire "linhas e bolinhas".
  const lanes = [58, 90, 122];
  return (
    <svg {...artProps}>
      {/* ar sujo entrando */}
      {lanes.map((y) => (
        <g key={`in-${y}`} className="lp-art-dirty-flow">
          <path d={`M26 ${y} H88`} />
          <path d={`M82 ${y - 5} l6 5 l-6 5`} />
        </g>
      ))}
      {[
        [38, 42], [62, 72], [34, 104], [58, 138], [44, 76], [70, 108],
      ].map(([cx, cy], i) => (
        <circle key={`dust-${cx}-${cy}`} cx={cx} cy={cy} r={i % 2 ? 4.5 : 3} className="lp-art-dust" />
      ))}

      {/* filtro: malha + a sujeira que ficou presa na face de entrada */}
      <rect x="96" y="28" width="38" height="120" rx="9" className="lp-art-card" />
      {Array.from({ length: 7 }).map((_, i) => (
        <path key={i} d={`M101 ${40 + i * 17} h28`} className="lp-art-filter" />
      ))}
      {[46, 70, 94, 118, 136].map((cy) => (
        <circle key={`held-${cy}`} cx="96" cy={cy} r="3.5" className="lp-art-dust" />
      ))}

      {/* ar limpo saindo */}
      {lanes.map((y) => (
        <g key={`out-${y}`} className="lp-art-clean-flow">
          <path d={`M142 ${y} H204`} />
          <path d={`M198 ${y - 5} l6 5 l-6 5`} />
        </g>
      ))}
      <path d="M188 20 c-13 10 -19 21 -6 29 11 -6 15 -19 6 -29 z" className="lp-art-leaf" />

      <text x="57" y="168" textAnchor="middle" className="lp-art-text">ar sujo</text>
      <text x="173" y="168" textAnchor="middle" className="lp-art-text">ar filtrado</text>
    </svg>
  );
}

function ArtSafety() {
  return (
    <svg {...artProps}>
      {/* escudo com verificação + risco elétrico contido */}
      <path d="M120 26 L176 46 v44 c0 32 -24 54 -56 64 -32 -10 -56 -32 -56 -64 V46 Z" className="lp-art-accent-soft" />
      <path d="M120 26 L176 46 v44 c0 32 -24 54 -56 64 -32 -10 -56 -32 -56 -64 V46 Z" className="lp-art-shield-edge" />
      <path d="M100 92 l14 14 l28 -30" className="lp-art-check-lg" />
      <path d="M36 52 l-10 18 h8 l-6 16 14 -22 h-8 z" className="lp-art-muted-icon" />
      <circle cx="206" cy="120" r="14" className="lp-art-hole" />
      <path d="M206 112 v9" className="lp-art-alert" />
      <circle cx="206" cy="127" r="1.8" className="lp-art-alert-dot" />
    </svg>
  );
}

function ArtSavings() {
  // Duas barras na MESMA linha de base (é o que fazia o gráfico parecer quebrado),
  // rótulos abaixo do eixo e a seta mostrando a queda de custo entre elas.
  const baseline = 144;
  const bars = [
    { x: 40, top: 44, label: "corretiva", className: "lp-art-bar-high" },
    { x: 104, top: 104, label: "preventiva", className: "lp-art-accent" },
  ];
  return (
    <svg {...artProps}>
      {bars.map((bar) => (
        <g key={bar.label}>
          <rect
            x={bar.x}
            y={bar.top}
            width="44"
            height={baseline - bar.top}
            rx="6"
            className={bar.className}
          />
          <text x={bar.x + 22} y={baseline + 18} textAnchor="middle" className="lp-art-text">
            {bar.label}
          </text>
        </g>
      ))}
      <path d={`M26 ${baseline} H214`} className="lp-art-axis" />

      {/* queda de custo: do topo da corretiva para o topo da preventiva */}
      <path d="M88 50 C 96 72, 98 82, 102 98" className="lp-art-arrow" />
      <path d="M102 100 l-7 -5 m7 5 l2 -8" className="lp-art-arrow" />

      {/* o que sobra no caixa */}
      <g>
        <ellipse cx="192" cy="136" rx="20" ry="7" className="lp-art-accent-soft" />
        <ellipse cx="192" cy="124" rx="20" ry="7" className="lp-art-accent-soft" />
        <ellipse cx="192" cy="112" rx="20" ry="7" className="lp-art-accent" />
        <text x="192" y={baseline + 18} textAnchor="middle" className="lp-art-text">
          economia
        </text>
      </g>
    </svg>
  );
}

const BENEFITS: Benefit[] = [
  {
    key: "overview",
    title: "Por que fazer manutenção preventiva?",
    text: "É a rotina programada de limpeza, inspeção e ajuste do equipamento. Em vez de esperar a falha, antecipamos o problema — com checklist técnico e registro de cada etapa.",
    art: <ArtOverview />,
  },
  {
    key: "energy",
    title: "Menos consumo de energia",
    text: "Filtros sujos e gás fora do nível obrigam o compressor a trabalhar mais. Com o equipamento limpo e regulado, ele atinge a temperatura mais rápido e pesa menos na conta de luz.",
    art: <ArtEnergy />,
  },
  {
    key: "lifespan",
    title: "Vida útil prolongada",
    text: "O desgaste some quando as peças críticas são inspecionadas no tempo certo. A preventiva adia a troca do aparelho e protege o seu investimento por muito mais tempo.",
    art: <ArtLifespan />,
  },
  {
    key: "air",
    title: "Ar mais limpo e saudável",
    text: "Sem limpeza, o evaporador acumula poeira, fungos e bactérias que circulam pelo ambiente. A higienização periódica melhora a qualidade do ar de quem passa horas ali dentro.",
    art: <ArtAirQuality />,
  },
  {
    key: "safety",
    title: "Mais segurança na operação",
    text: "Conexões elétricas, drenos e fixações são verificados a cada visita — evitando curto-circuito, vazamento de água e risco de queda do equipamento.",
    art: <ArtSafety />,
  },
  {
    key: "savings",
    title: "Economia real no fim das contas",
    text: "Um reparo emergencial custa muito mais que a manutenção programada — e ainda para o ambiente. Prevenir é previsível: você planeja o gasto em vez de ser surpreendido.",
    art: <ArtSavings />,
  },
];

export function PreventiveBenefitsSection() {
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const total = BENEFITS.length;
  const regionRef = useRef<HTMLDivElement>(null);

  const go = useCallback((next: number) => setIndex(((next % total) + total) % total), [total]);

  useEffect(() => {
    if (paused) return;
    if (typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const timer = window.setInterval(() => setIndex((current) => (current + 1) % total), AUTOPLAY_MS);
    return () => window.clearInterval(timer);
  }, [paused, total]);

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "ArrowRight") { event.preventDefault(); go(index + 1); }
    if (event.key === "ArrowLeft") { event.preventDefault(); go(index - 1); }
  };

  return (
    <section id="preventiva" className="lp-section lp-section--cool">
      <div className="lp-container">
        <header className="lp-section__head" data-reveal>
          <span className="lp-eyebrow">Manutenção preventiva</span>
          <h2 className="lp-section__title">Por que a preventiva vale a pena</h2>
          <p className="lp-section__sub">
            Os ganhos de manter o ar-condicionado em dia — do bolso à saúde de quem usa o ambiente.
          </p>
        </header>

        <div
          ref={regionRef}
          className="lp-carousel"
          data-reveal
          role="group"
          aria-roledescription="carrossel"
          aria-label="Benefícios da manutenção preventiva"
          tabIndex={0}
          onKeyDown={onKeyDown}
          onMouseEnter={() => setPaused(true)}
          onMouseLeave={() => setPaused(false)}
          onFocus={() => setPaused(true)}
          onBlur={() => setPaused(false)}
        >
          <div className="lp-carousel__viewport">
            <div className="lp-carousel__track" style={{ transform: `translateX(-${index * 100}%)` }}>
              {BENEFITS.map((benefit, i) => (
                <article
                  key={benefit.key}
                  className="lp-slide"
                  aria-hidden={i !== index}
                  aria-roledescription="slide"
                  aria-label={`${i + 1} de ${total}: ${benefit.title}`}
                >
                  <div className="lp-slide__art">{benefit.art}</div>
                  <div className="lp-slide__body">
                    <span className="lp-slide__step">
                      {String(i + 1).padStart(2, "0")} <i>/ {String(total).padStart(2, "0")}</i>
                    </span>
                    <h3 className="lp-slide__title">{benefit.title}</h3>
                    <p className="lp-slide__text">{benefit.text}</p>
                  </div>
                </article>
              ))}
            </div>
          </div>

          <button type="button" className="lp-carousel__nav lp-carousel__nav--prev" onClick={() => go(index - 1)} aria-label="Benefício anterior">
            <ChevronLeft size={20} />
          </button>
          <button type="button" className="lp-carousel__nav lp-carousel__nav--next" onClick={() => go(index + 1)} aria-label="Próximo benefício">
            <ChevronRight size={20} />
          </button>
        </div>

        <div className="lp-carousel__dots" role="tablist" aria-label="Selecionar benefício">
          {BENEFITS.map((benefit, i) => (
            <button
              key={benefit.key}
              type="button"
              role="tab"
              aria-selected={i === index}
              aria-label={benefit.title}
              className={`lp-dot ${i === index ? "lp-dot--active" : ""}`}
              onClick={() => go(i)}
            />
          ))}
        </div>
      </div>
    </section>
  );
}
