-- CybhorPDV API — Schema MySQL 8 / MariaDB 10.6+ (multi-loja)
-- Executar uma vez: mysql -u <usuario> -p <banco> < db/schema.sql
--
-- Decisões de portabilidade (PostgreSQL -> MySQL):
-- * UUID vira CHAR(36) gerado no Node (crypto.randomUUID), mesmo formato do Postgres.
-- * TIMESTAMPTZ vira DATETIME(3) sempre em UTC (a API fixa time_zone='+00:00' na sessão).
-- * Colunas de identificador usam utf8mb4_bin para comparar exatamente como o Postgres
--   (a collation padrão do MySQL ignora caixa e acento: 'jose' = 'José').
-- * Sem DEFAULT em TEXT/JSON porque o MySQL não aceita; a API sempre envia o valor.

CREATE TABLE IF NOT EXISTS lojas (
  id CHAR(36) CHARACTER SET ascii NOT NULL PRIMARY KEY,
  nome VARCHAR(255) NOT NULL,
  cnpj VARCHAR(32) NOT NULL DEFAULT '',
  endereco VARCHAR(500) NOT NULL DEFAULT '',
  telefone VARCHAR(64) NOT NULL DEFAULT '',
  email VARCHAR(255) NOT NULL DEFAULT '',
  cpf VARCHAR(11) NOT NULL DEFAULT '',
  responsavel_nome VARCHAR(255) NOT NULL DEFAULT '',
  responsavel_sobrenome VARCHAR(255) NOT NULL DEFAULT '',
  codigo VARCHAR(8) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  ativa BOOLEAN NOT NULL DEFAULT TRUE,
  criado_em DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  atualizado_em DATETIME(3) NULL,
  UNIQUE KEY uq_lojas_codigo (codigo),
  KEY idx_lojas_cpf (cpf)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS funcionarios (
  id CHAR(36) CHARACTER SET ascii NOT NULL PRIMARY KEY,
  loja_id CHAR(36) CHARACTER SET ascii NOT NULL,
  nome VARCHAR(255) NOT NULL,
  usuario VARCHAR(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  salt VARCHAR(64) NOT NULL,
  senha_hash VARCHAR(128) NOT NULL,
  cargo VARCHAR(16) NOT NULL,
  dados JSON NOT NULL,
  criado_em DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  atualizado_em DATETIME(3) NULL,
  UNIQUE KEY uq_funcionarios_loja_usuario (loja_id, usuario),
  KEY idx_funcionarios_loja (loja_id),
  CONSTRAINT ck_funcionarios_cargo CHECK (cargo IN ('admin', 'operador')),
  CONSTRAINT fk_funcionarios_loja FOREIGN KEY (loja_id) REFERENCES lojas (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS produtos (
  id CHAR(36) CHARACTER SET ascii NOT NULL PRIMARY KEY,
  loja_id CHAR(36) CHARACTER SET ascii NOT NULL,
  nome VARCHAR(255) NOT NULL,
  codigo_barras VARCHAR(64) NOT NULL DEFAULT '',
  preco DECIMAL(12, 2) NOT NULL,
  estoque INT NOT NULL DEFAULT 0,
  categoria VARCHAR(255) NOT NULL DEFAULT '',
  criado_em DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  atualizado_em DATETIME(3) NULL,
  KEY idx_produtos_loja (loja_id),
  KEY idx_produtos_codigo_barras (loja_id, codigo_barras),
  CONSTRAINT ck_produtos_preco CHECK (preco >= 0),
  CONSTRAINT ck_produtos_estoque CHECK (estoque >= 0),
  CONSTRAINT fk_produtos_loja FOREIGN KEY (loja_id) REFERENCES lojas (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS vendas (
  id CHAR(36) CHARACTER SET ascii NOT NULL PRIMARY KEY,
  loja_id CHAR(36) CHARACTER SET ascii NOT NULL,
  funcionario_id CHAR(36) CHARACTER SET ascii NULL,
  funcionario_nome VARCHAR(255) NOT NULL,
  subtotal DECIMAL(12, 2) NOT NULL,
  desconto DECIMAL(12, 2) NOT NULL DEFAULT 0,
  total DECIMAL(12, 2) NOT NULL,
  forma_pagamento VARCHAR(64) NOT NULL,
  criado_em DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY idx_vendas_loja_data (loja_id, criado_em),
  CONSTRAINT fk_vendas_loja FOREIGN KEY (loja_id) REFERENCES lojas (id) ON DELETE CASCADE,
  CONSTRAINT fk_vendas_funcionario FOREIGN KEY (funcionario_id) REFERENCES funcionarios (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS venda_itens (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  venda_id CHAR(36) CHARACTER SET ascii NOT NULL,
  produto_id CHAR(36) CHARACTER SET ascii NULL,
  nome VARCHAR(255) NOT NULL,
  quantidade INT NOT NULL,
  preco_unitario DECIMAL(12, 2) NOT NULL,
  subtotal DECIMAL(12, 2) NOT NULL,
  KEY idx_venda_itens_venda (venda_id),
  CONSTRAINT ck_venda_itens_quantidade CHECK (quantidade > 0),
  CONSTRAINT fk_venda_itens_venda FOREIGN KEY (venda_id) REFERENCES vendas (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Administradores do SISTEMA (dono do produto — controla todas as lojas)
CREATE TABLE IF NOT EXISTS administradores_sistema (
  id CHAR(36) CHARACTER SET ascii NOT NULL PRIMARY KEY,
  nome VARCHAR(255) NOT NULL,
  email VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  salt VARCHAR(64) NOT NULL,
  senha_hash VARCHAR(128) NOT NULL,
  criado_em DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_administradores_email (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Assinatura de cada loja (cobrança via Mercado Pago)
CREATE TABLE IF NOT EXISTS assinaturas (
  id CHAR(36) CHARACTER SET ascii NOT NULL PRIMARY KEY,
  loja_id CHAR(36) CHARACTER SET ascii NOT NULL,
  plano VARCHAR(32) NOT NULL DEFAULT 'mensal',
  valor_mensal DECIMAL(10, 2) NOT NULL DEFAULT 0,
  status VARCHAR(16) NOT NULL DEFAULT 'pendente',
  mp_preference_id VARCHAR(255) NULL,
  token_ativacao VARCHAR(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NULL,
  valida_ate DATE NULL,
  atualizado_em DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_assinaturas_loja (loja_id),
  UNIQUE KEY uq_assinaturas_token (token_ativacao),
  CONSTRAINT ck_assinaturas_status CHECK (status IN ('pendente', 'ativa', 'inadimplente', 'cancelada')),
  CONSTRAINT fk_assinaturas_loja FOREIGN KEY (loja_id) REFERENCES lojas (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Histórico de pagamentos (webhook do Mercado Pago)
CREATE TABLE IF NOT EXISTS pagamentos (
  id CHAR(36) CHARACTER SET ascii NOT NULL PRIMARY KEY,
  loja_id CHAR(36) CHARACTER SET ascii NOT NULL,
  mp_payment_id VARCHAR(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NULL,
  status VARCHAR(32) NOT NULL,
  valor DECIMAL(10, 2) NULL,
  payload JSON NULL,
  criado_em DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_pagamentos_mp_payment (mp_payment_id),
  KEY idx_pagamentos_loja_criado (loja_id, criado_em),
  CONSTRAINT fk_pagamentos_loja FOREIGN KEY (loja_id) REFERENCES lojas (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Um teste grátis de 30 dias por CPF (primeira compra).
CREATE TABLE IF NOT EXISTS trials_cpf (
  cpf VARCHAR(11) CHARACTER SET ascii NOT NULL PRIMARY KEY,
  loja_id CHAR(36) CHARACTER SET ascii NOT NULL,
  criado_em DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_trials_cpf_loja FOREIGN KEY (loja_id) REFERENCES lojas (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Aceite das Diretrizes da comunidade na compra pelo site.
-- Uma linha por aceite: se a versão mudar e o cliente aceitar de novo, o histórico fica.
CREATE TABLE IF NOT EXISTS aceites_diretrizes (
  id CHAR(36) CHARACTER SET ascii NOT NULL PRIMARY KEY,
  loja_id CHAR(36) CHARACTER SET ascii NOT NULL,
  versao VARCHAR(32) NOT NULL,
  ip VARCHAR(64) NOT NULL DEFAULT '',
  navegador VARCHAR(300) NOT NULL DEFAULT '',
  aceito_em DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY idx_aceites_diretrizes_loja (loja_id, aceito_em),
  CONSTRAINT fk_aceites_diretrizes_loja FOREIGN KEY (loja_id) REFERENCES lojas (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Dados flexíveis dos módulos avançados do desktop (clientes, despesas,
-- fornecedores, caixa, auditoria etc.). Cada recurso fica isolado por loja
-- e todas as alterações passam pela API autenticada.
CREATE TABLE IF NOT EXISTS documentos_loja (
  loja_id CHAR(36) CHARACTER SET ascii NOT NULL,
  recurso VARCHAR(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  dados JSON NOT NULL,
  atualizado_em DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (loja_id, recurso),
  CONSTRAINT fk_documentos_loja FOREIGN KEY (loja_id) REFERENCES lojas (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
