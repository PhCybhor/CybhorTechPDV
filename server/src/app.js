import { existsSync } from 'node:fs';
import express from 'express';
import { config } from './config.js';
import { ErroNegocio } from './errors.js';
import {
  TAMANHO_MAX_REQUISICAO_BYTES,
  cabecalhosSeguranca,
  criarMiddlewareCors,
} from './httpSeguranca.js';
import { logger } from './logger.js';
import { criarRotasApi } from './routes/index.js';

const MENSAGEM_ERRO_INTERNO = 'Erro interno. Tente novamente em instantes.';

// Violações de limite/formato do MySQL causadas por entrada do usuário (texto longo
// demais, número fora da faixa, CHECK): são 400, não falha do servidor.
const CODIGOS_MYSQL_DADOS_INVALIDOS = new Set([
  'ER_DATA_TOO_LONG',
  'ER_WARN_DATA_OUT_OF_RANGE',
  'ER_WARN_DATA_TRUNCATED',
  'ER_TRUNCATED_WRONG_VALUE_FOR_FIELD',
  'ER_TRUNCATED_WRONG_VALUE',
  'ER_CHECK_CONSTRAINT_VIOLATED',
  'ER_INVALID_JSON_TEXT',
]);

/** Redireciona /admin para /admin/ preservando a query (o static não resolve sem a barra). */
function redirecionarAdminSemBarra(req, res, next) {
  const [caminho, query] = req.originalUrl.split('?');
  if (caminho !== '/admin') {
    next();
    return;
  }
  res.redirect(307, query ? `/admin/?${query}` : '/admin/');
}

function montarArquivosEstaticos(app) {
  if (existsSync(config.diretorioAdmin)) {
    app.use('/admin', redirecionarAdminSemBarra);
    app.use('/admin', express.static(config.diretorioAdmin, { index: 'index.html', redirect: false }));
  } else {
    logger.warn('painel admin nao encontrado; /admin desativado');
  }
  if (existsSync(config.diretorioLanding)) {
    app.use('/', express.static(config.diretorioLanding, { index: 'index.html' }));
  } else {
    logger.warn('landing nao encontrada; / desativado');
  }
}

function rotaNaoEncontrada(_req, res) {
  res.status(404).json({ erro: 'Not Found' });
}

// O Express identifica middleware de erro pela aridade (4 parâmetros).
function tratarErro(erro, req, res, _next) {
  if (res.headersSent) {
    req.socket.destroy();
    return;
  }

  if (erro instanceof ErroNegocio) {
    res.status(erro.status).json({ erro: erro.mensagem });
    return;
  }
  if (erro?.type === 'entity.too.large') {
    res.status(413).json({ erro: 'Requisicao grande demais.' });
    return;
  }
  if (erro?.type?.startsWith?.('entity.') || erro?.type === 'encoding.unsupported') {
    res.status(422).json({ erro: 'Dados invalidos.' });
    return;
  }
  if (CODIGOS_MYSQL_DADOS_INVALIDOS.has(erro?.code)) {
    res.status(400).json({ erro: 'Dados invalidos.' });
    return;
  }

  logger.error(`${req.method} ${req.path}`, erro);
  res.status(500).json({ erro: MENSAGEM_ERRO_INTERNO });
}

/** Monta a aplicação Express (sem abrir porta nem conectar ao banco). */
export function criarApp() {
  const app = express();
  app.disable('x-powered-by');

  app.use(criarMiddlewareCors());
  app.use(cabecalhosSeguranca);
  // `type` aceita qualquer Content-Type: clientes legados (IPN do MP) omitem o cabeçalho.
  app.use(express.json({ limit: TAMANHO_MAX_REQUISICAO_BYTES, type: () => true }));

  app.use('/api', criarRotasApi());
  app.use('/api', rotaNaoEncontrada);
  montarArquivosEstaticos(app);
  app.use(rotaNaoEncontrada);
  app.use(tratarErro);

  return app;
}
