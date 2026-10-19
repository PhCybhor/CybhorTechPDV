import { ErroNegocio } from './errors.js';

/** @param {unknown} valor */
export function somenteDigitos(valor) {
  return String(valor ?? '').replace(/\D/g, '');
}

function calcularDigitoVerificador(base) {
  const pesoInicial = base.length + 1;
  const soma = [...base].reduce((acumulado, digito, indice) => acumulado + Number(digito) * (pesoInicial - indice), 0);
  const resto = (soma * 10) % 11;
  return resto === 10 ? '0' : String(resto);
}

/**
 * Normaliza e valida CPF (11 dígitos + DV). Um CPF por teste grátis.
 * @param {unknown} valor
 * @returns {string} CPF só com dígitos.
 * @throws {ErroNegocio}
 */
export function validarCpf(valor) {
  const cpf = somenteDigitos(valor);
  if (cpf.length !== 11 || cpf === cpf[0].repeat(11)) {
    throw new ErroNegocio('Informe um CPF valido.');
  }
  const digitosConferem =
    cpf[9] === calcularDigitoVerificador(cpf.slice(0, 9)) &&
    cpf[10] === calcularDigitoVerificador(cpf.slice(0, 10));
  if (!digitosConferem) {
    throw new ErroNegocio('Informe um CPF valido.');
  }
  return cpf;
}
