-- CybhorPDV API — Schema MySQL 8 (multi-loja)
-- Executar uma vez: npm run db:schema   (ou mysql -u <usuario> -p cybhorpdv < db/schema.mysql.sql)
--
-- Convencoes:
--  * IDs sao CHAR(36) gerados na aplicacao (crypto.randomUUID()); nao ha DEFAULT no banco.
--  * Datas em UTC (a API fixa time_zone = '+00:00' em cada conexao).
--  * Colunas "usuario" usam utf8mb4_bin: o login e sensivel a acentos/caixa, como no PostgreSQL.
--  * O script e idempotente (CREATE TABLE IF NOT EXISTS).

SET NAMES utf8mb4;

-- Lojas (tenants)
CREATE TABLE IF NOT EXISTS lojas (
  id CHAR(36) NOT NULL,
  nome VARCHAR(255) NOT NULL,
  cnpj VARCHAR(32) NOT NULL DEFAULT '',
  endereco VARCHAR(500) NOT NULL DEFAULT '',
  telefone VARCHAR(40) NOT NULL DEFAULT '',
  email VARCHAR(255) NOT NULL DEFAULT '',
  cpf VARCHAR(20) NOT NULL DEFAULT '',
  responsavel_nome VARCHAR(255) NOT NULL DEFAULT '',
  responsavel_sobrenome VARCHAR(255) NOT NULL DEFAULT '',
  codigo VARCHAR(8) NOT NULL,
  ativa BOOLEAN NOT NULL DEFAULT TRUE,
  criado_em DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  atualizado_em DATETIME(3) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_lojas_codigo (codigo),
  KEY idx_lojas_cpf (cpf),
  KEY idx_lojas_email (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Funcionarios de cada loja (login do PDV)
CREATE TABLE IF NOT EXISTS funcionarios (
  id CHAR(36) NOT NULL,
  loja_id CHAR(36) NOT NULL,
  nome VARCHAR(255) NOT NULL,
  usuario VARCHAR(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  salt VARCHAR(64) NOT NULL,
  senha_hash VARCHAR(128) NOT NULL,
  cargo VARCHAR(16) NOT NULL,
  dados JSON NOT NULL DEFAULT (JSON_OBJECT()),
  criado_em DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  atualizado_em DATETIME(3) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_funcionarios_loja_usuario (loja_id, usuario),
  KEY idx_funcionarios_usuario (usuario),
  CONSTRAINT fk_funcionarios_loja FOREIGN KEY (loja_id) REFERENCES lojas (id) ON DELETE CASCADE,
  CONSTRAINT ck_funcionarios_cargo CHECK (cargo IN ('admin', 'operador'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Produtos por loja
CREATE TABLE IF NOT EXISTS produtos (
  id CHAR(36) NOT NULL,
  loja_id CHAR(36) NOT NULL,
  nome VARCHAR(255) NOT NULL,
  codigo_barras VARCHAR(64) NOT NULL DEFAULT '',
  preco DECIMAL(12, 2) NOT NULL,
  estoque INT NOT NULL DEFAULT 0,
  categoria VARCHAR(255) NOT NULL DEFAULT '',
  criado_em DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  atualizado_em DATETIME(3) NULL,
  PRIMARY KEY (id),
  KEY idx_produtos_loja (loja_id),
  KEY idx_produtos_codigo_barras (loja_id, codigo_barras),
  CONSTRAINT fk_produtos_loja FOREIGN KEY (loja_id) REFERENCES lojas (id) ON DELETE CASCADE,
  CONSTRAINT ck_produtos_preco CHECK (preco >= 0),
  CONSTRAINT ck_produtos_estoque CHECK (estoque >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Vendas por loja
CREATE TABLE IF NOT EXISTS vendas (
  id CHAR(36) NOT NULL,
  loja_id CHAR(36) NOT NULL,
  funcionario_id CHAR(36) NULL,
  funcionario_nome VARCHAR(255) NOT NULL,
  subtotal DECIMAL(12, 2) NOT NULL,
  desconto DECIMAL(12, 2) NOT NULL DEFAULT 0,
  total DECIMAL(12, 2) NOT NULL,
  forma_pagamento VARCHAR(32) NOT NULL,
  criado_em DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_vendas_loja_data (loja_id, criado_em),
  KEY idx_vendas_funcionario (funcionario_id),
  CONSTRAINT fk_vendas_loja FOREIGN KEY (loja_id) REFERENCES lojas (id) ON DELETE CASCADE,
  CONSTRAINT fk_vendas_funcionario FOREIGN KEY (funcionario_id) REFERENCES funcionarios (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS venda_itens (
  id BIGINT NOT NULL AUTO_INCREMENT,
  venda_id CHAR(36) NOT NULL,
  produto_id CHAR(36) NULL,
  nome VARCHAR(255) NOT NULL,
  quantidade INT NOT NULL,
  preco_unitario DECIMAL(12, 2) NOT NULL,
  subtotal DECIMAL(12, 2) NOT NULL,
  PRIMARY KEY (id),
  KEY idx_venda_itens_venda (venda_id),
  CONSTRAINT fk_venda_itens_venda FOREIGN KEY (venda_id) REFERENCES vendas (id) ON DELETE CASCADE,
  CONSTRAINT ck_venda_itens_quantidade CHECK (quantidade > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Administradores do SISTEMA (dono do produto — controla todas as lojas)
CREATE TABLE IF NOT EXISTS administradores_sistema (
  id CHAR(36) NOT NULL,
  nome VARCHAR(255) NOT NULL,
  email VARCHAR(255) NOT NULL,
  salt VARCHAR(64) NOT NULL,
  senha_hash VARCHAR(128) NOT NULL,
  criado_em DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_administradores_email (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Assinatura de cada loja (cobranca via Mercado Pago)
CREATE TABLE IF NOT EXISTS assinaturas (
  id CHAR(36) NOT NULL,
  loja_id CHAR(36) NOT NULL,
  plano VARCHAR(32) NOT NULL DEFAULT 'mensal',
  valor_mensal DECIMAL(10, 2) NOT NULL DEFAULT 0,
  status VARCHAR(16) NOT NULL DEFAULT 'pendente',
  mp_preference_id VARCHAR(128) NULL,
  token_ativacao VARCHAR(64) NULL,
  valida_ate DATE NULL,
  atualizado_em DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_assinaturas_loja (loja_id),
  UNIQUE KEY uq_assinaturas_token_ativacao (token_ativacao),
  CONSTRAINT fk_assinaturas_loja FOREIGN KEY (loja_id) REFERENCES lojas (id) ON DELETE CASCADE,
  CONSTRAINT ck_assinaturas_status CHECK (status IN ('pendente', 'ativa', 'inadimplente', 'cancelada'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Historico de pagamentos (webhook do Mercado Pago)
CREATE TABLE IF NOT EXISTS pagamentos (
  id CHAR(36) NOT NULL,
  loja_id CHAR(36) NOT NULL,
  mp_payment_id VARCHAR(32) NULL,
  status VARCHAR(32) NOT NULL,
  valor DECIMAL(10, 2) NULL,
  payload JSON NULL,
  criado_em DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_pagamentos_mp_payment_id (mp_payment_id),
  -- detalhar_loja: WHERE loja_id ORDER BY criado_em DESC
  KEY idx_pagamentos_loja_criado (loja_id, criado_em DESC),
  CONSTRAINT fk_pagamentos_loja FOREIGN KEY (loja_id) REFERENCES lojas (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Um teste gratis de 30 dias por CPF (primeira compra).
CREATE TABLE IF NOT EXISTS trials_cpf (
  cpf VARCHAR(11) NOT NULL,
  loja_id CHAR(36) NOT NULL,
  criado_em DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (cpf),
  KEY idx_trials_cpf_loja (loja_id),
  CONSTRAINT fk_trials_cpf_loja FOREIGN KEY (loja_id) REFERENCES lojas (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Aceite das Diretrizes da comunidade na compra pelo site.
-- Uma linha por aceite: se a versao mudar e o cliente aceitar de novo, o historico fica.
CREATE TABLE IF NOT EXISTS aceites_diretrizes (
  id CHAR(36) NOT NULL,
  loja_id CHAR(36) NOT NULL,
  versao VARCHAR(32) NOT NULL,
  ip VARCHAR(64) NOT NULL DEFAULT '',
  navegador VARCHAR(300) NOT NULL DEFAULT '',
  aceito_em DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_aceites_diretrizes_loja (loja_id, aceito_em DESC),
  CONSTRAINT fk_aceites_diretrizes_loja FOREIGN KEY (loja_id) REFERENCES lojas (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Dados flexiveis dos modulos avancados do desktop (clientes, despesas,
-- fornecedores, caixa, auditoria etc.). Cada recurso fica isolado por loja
-- e todas as alteracoes passam pela API autenticada.
CREATE TABLE IF NOT EXISTS documentos_loja (
  loja_id CHAR(36) NOT NULL,
  recurso VARCHAR(128) NOT NULL,
  dados JSON NOT NULL DEFAULT (JSON_OBJECT()),
  atualizado_em DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (loja_id, recurso),
  CONSTRAINT fk_documentos_loja_loja FOREIGN KEY (loja_id) REFERENCES lojas (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
