-- CybhorPDV API — Schema PostgreSQL (multi-loja)
-- Executar uma vez: psql -U cybhor -d cybhorpdv -f db/schema.sql

CREATE EXTENSION IF NOT EXISTS pgcrypto; -- gen_random_uuid()

-- Lojas (tenants)
CREATE TABLE IF NOT EXISTS lojas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nome TEXT NOT NULL,
  cnpj TEXT NOT NULL DEFAULT '',
  endereco TEXT NOT NULL DEFAULT '',
  telefone TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  cpf TEXT NOT NULL DEFAULT '',
  responsavel_nome TEXT NOT NULL DEFAULT '',
  responsavel_sobrenome TEXT NOT NULL DEFAULT '',
  codigo VARCHAR(8) NOT NULL UNIQUE,
  ativa BOOLEAN NOT NULL DEFAULT TRUE,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
  atualizado_em TIMESTAMPTZ
);

-- Funcionarios de cada loja (login do PDV)
CREATE TABLE IF NOT EXISTS funcionarios (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  loja_id UUID NOT NULL REFERENCES lojas(id) ON DELETE CASCADE,
  nome TEXT NOT NULL,
  usuario TEXT NOT NULL,
  salt TEXT NOT NULL,
  senha_hash TEXT NOT NULL,
  cargo TEXT NOT NULL CHECK (cargo IN ('admin', 'operador')),
  dados JSONB NOT NULL DEFAULT '{}'::jsonb,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
  atualizado_em TIMESTAMPTZ,
  UNIQUE (loja_id, usuario)
);
CREATE INDEX IF NOT EXISTS idx_funcionarios_loja ON funcionarios (loja_id);
ALTER TABLE funcionarios
  ADD COLUMN IF NOT EXISTS dados JSONB NOT NULL DEFAULT '{}'::jsonb;

-- Produtos por loja
CREATE TABLE IF NOT EXISTS produtos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  loja_id UUID NOT NULL REFERENCES lojas(id) ON DELETE CASCADE,
  nome TEXT NOT NULL,
  codigo_barras TEXT NOT NULL DEFAULT '',
  preco NUMERIC(12, 2) NOT NULL CHECK (preco >= 0),
  estoque INTEGER NOT NULL DEFAULT 0 CHECK (estoque >= 0),
  categoria TEXT NOT NULL DEFAULT '',
  criado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
  atualizado_em TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_produtos_loja ON produtos (loja_id);
CREATE INDEX IF NOT EXISTS idx_produtos_codigo_barras ON produtos (loja_id, codigo_barras);

-- Vendas por loja
CREATE TABLE IF NOT EXISTS vendas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  loja_id UUID NOT NULL REFERENCES lojas(id) ON DELETE CASCADE,
  funcionario_id UUID REFERENCES funcionarios(id) ON DELETE SET NULL,
  funcionario_nome TEXT NOT NULL,
  subtotal NUMERIC(12, 2) NOT NULL,
  desconto NUMERIC(12, 2) NOT NULL DEFAULT 0,
  total NUMERIC(12, 2) NOT NULL,
  forma_pagamento TEXT NOT NULL,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_vendas_loja_data ON vendas (loja_id, criado_em);

CREATE TABLE IF NOT EXISTS venda_itens (
  id BIGSERIAL PRIMARY KEY,
  venda_id UUID NOT NULL REFERENCES vendas(id) ON DELETE CASCADE,
  produto_id UUID,
  nome TEXT NOT NULL,
  quantidade INTEGER NOT NULL CHECK (quantidade > 0),
  preco_unitario NUMERIC(12, 2) NOT NULL,
  subtotal NUMERIC(12, 2) NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_venda_itens_venda ON venda_itens (venda_id);

-- Administradores do SISTEMA (dono do produto — controla todas as lojas)
CREATE TABLE IF NOT EXISTS administradores_sistema (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nome TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  salt TEXT NOT NULL,
  senha_hash TEXT NOT NULL,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Assinatura de cada loja (cobranca mensal via Mercado Pago)
CREATE TABLE IF NOT EXISTS assinaturas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  loja_id UUID NOT NULL UNIQUE REFERENCES lojas(id) ON DELETE CASCADE,
  plano TEXT NOT NULL DEFAULT 'mensal',
  valor_mensal NUMERIC(10, 2) NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pendente'
    CHECK (status IN ('pendente', 'ativa', 'inadimplente', 'cancelada')),
  mp_preference_id TEXT,
  token_ativacao TEXT UNIQUE,
  valida_ate DATE,
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Historico de pagamentos (webhook do Mercado Pago)
CREATE TABLE IF NOT EXISTS pagamentos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  loja_id UUID NOT NULL REFERENCES lojas(id) ON DELETE CASCADE,
  mp_payment_id TEXT UNIQUE,
  status TEXT NOT NULL,
  valor NUMERIC(10, 2),
  payload JSONB,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_pagamentos_loja ON pagamentos (loja_id);

-- Um teste gratis de 30 dias por CPF (primeira compra).
CREATE TABLE IF NOT EXISTS trials_cpf (
  cpf VARCHAR(11) PRIMARY KEY,
  loja_id UUID NOT NULL REFERENCES lojas(id) ON DELETE CASCADE,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_lojas_cpf ON lojas (cpf) WHERE cpf <> '';

-- Dados flexiveis dos modulos avancados do desktop (clientes, despesas,
-- fornecedores, caixa, auditoria etc.). Cada recurso fica isolado por loja
-- e todas as alteracoes passam pela API autenticada.
CREATE TABLE IF NOT EXISTS documentos_loja (
  loja_id UUID NOT NULL REFERENCES lojas(id) ON DELETE CASCADE,
  recurso TEXT NOT NULL,
  dados JSONB NOT NULL DEFAULT '{}'::jsonb,
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (loja_id, recurso)
);
CREATE INDEX IF NOT EXISTS idx_documentos_loja_recurso
  ON documentos_loja (loja_id, recurso);
