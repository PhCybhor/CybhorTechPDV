"use strict";

const { env, validarObrigatorias } = require("./config/env");

validarObrigatorias();

const app = require("./app");

app.listen(env.porta, () => {
  console.log(`API CybhorPDV ouvindo na porta ${env.porta}`);
});
