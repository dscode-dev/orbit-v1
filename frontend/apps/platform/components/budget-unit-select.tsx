"use client";

const UNIT_GROUPS = [
  { label: "Contagem e embalagem", options: [
    ["UN", "Unidade"], ["PC", "Peça"], ["PAR", "Par"], ["CJ", "Conjunto"],
    ["KIT", "Kit"], ["CX", "Caixa"], ["PCT", "Pacote"], ["RL", "Rolo"],
  ] },
  { label: "Comprimento, área e volume", options: [
    ["MM", "Milímetro"], ["CM", "Centímetro"], ["M", "Metro"],
    ["M²", "Metro quadrado"], ["M³", "Metro cúbico"], ["ML", "Mililitro"], ["L", "Litro"],
  ] },
  { label: "Massa", options: [
    ["MG", "Miligrama"], ["G", "Grama"], ["KG", "Quilograma"], ["T", "Tonelada"],
  ] },
  { label: "Força, torque e tempo", options: [
    ["N", "Newton"], ["KGF", "Quilograma-força"], ["N·M", "Newton-metro"],
    ["KGF·M", "Quilograma-força metro"], ["H", "Hora"],
  ] },
] as const;

export function BudgetUnitSelect({ value, onChange, className, ariaLabel = "Unidade" }: {
  value: string;
  onChange: (value: string) => void;
  className?: string;
  ariaLabel?: string;
}) {
  const known = UNIT_GROUPS.some((group) => group.options.some(([unit]) => unit === value));
  return (
    <select aria-label={ariaLabel} value={value} onChange={(event) => onChange(event.target.value)} className={className}>
      {!known && <option value={value}>{value || "Selecione"}{value ? " — Unidade cadastrada" : ""}</option>}
      {UNIT_GROUPS.map((group) => <optgroup key={group.label} label={group.label}>
        {group.options.map(([unit, label]) => <option key={unit} value={unit}>{unit} — {label}</option>)}
      </optgroup>)}
    </select>
  );
}
