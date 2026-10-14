import { ErroNegocio } from "../erros.js";
import { somenteDigitos } from "./entrada.js";

function calcularDigito(base) {
  let peso = base.length + 1;
  let soma = 0;
  for (const caractere of base) {
    soma += Number(caractere) * peso;
    peso -= 1;
  }
  const resto = (soma * 10) % 11;
  return resto === 10 ? "0" : String(resto);
}

/**
 * Normaliza e valida CPF (11 dígitos + DV). Um CPF por teste grátis.
 * @param {unknown} valor
 * @returns {string} só os dígitos.
 */
export function validarCpf(valor) {
  const cpf = somenteDigitos(valor);
  if (cpf.length !== 11 || cpf === cpf[0].repeat(11)) throw new ErroNegocio("Informe um CPF valido.");
  if (cpf[9] !== calcularDigito(cpf.slice(0, 9)) || cpf[10] !== calcularDigito(cpf.slice(0, 10))) {
    throw new ErroNegocio("Informe um CPF valido.");
  }
  return cpf;
}
