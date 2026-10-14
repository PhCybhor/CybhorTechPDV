"use strict";

/**
 * Define window.CYBHOR_API_BASE, a URL base da API usada pelas páginas do site.
 *
 * O site pode ser publicado separado da API (hospedagem compartilhada da
 * Hostinger) e, nesse caso, precisa chamar a VPS por URL absoluta. Quando a
 * própria API serve o site (VPS ou ambiente local), mantém a mesma origem para
 * não depender de CORS.
 */
(function definirApiBase() {
  const API_PRODUCAO = "https://pdv.vps10229.panel.icontainer.run";
  const HOSTS_LOCAIS = ["localhost", "127.0.0.1"];

  const servidoPelaApi =
    HOSTS_LOCAIS.includes(window.location.hostname) ||
    window.location.origin === API_PRODUCAO;

  window.CYBHOR_API_BASE = servidoPelaApi ? window.location.origin : API_PRODUCAO;
})();
