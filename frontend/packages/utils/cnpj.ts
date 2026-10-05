/** Só os dígitos do CNPJ. */
export function cnpjDigits(value: string): string {
  return value.replace(/\D/g, "");
}

/**
 * Valida o CNPJ pelos dígitos verificadores (módulo 11). Evita consultar a
 * Receita com um número digitado errado.
 */
export function isValidCnpj(value: string): boolean {
  const digits = cnpjDigits(value);
  if (digits.length !== 14 || /^(\d)\1{13}$/.test(digits)) return false;
  const check = (length: number) => {
    const weights = length === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const sum = weights.reduce((acc, weight, i) => acc + Number(digits[i]) * weight, 0);
    const rest = sum % 11;
    return rest < 2 ? 0 : 11 - rest;
  };
  return check(12) === Number(digits[12]) && check(13) === Number(digits[13]);
}
