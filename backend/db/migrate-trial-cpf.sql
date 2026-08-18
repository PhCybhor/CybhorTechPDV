-- Trial 30 dias limitado por CPF (idempotente).
ALTER TABLE lojas ADD COLUMN IF NOT EXISTS cpf TEXT NOT NULL DEFAULT '';

CREATE TABLE IF NOT EXISTS trials_cpf (
  cpf VARCHAR(11) PRIMARY KEY,
  loja_id UUID NOT NULL REFERENCES lojas(id) ON DELETE CASCADE,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_lojas_cpf ON lojas (cpf) WHERE cpf <> '';
