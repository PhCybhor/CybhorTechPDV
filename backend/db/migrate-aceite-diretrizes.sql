-- Aceite das Diretrizes da comunidade na compra pelo site (idempotente).
-- Uma linha por aceite: se a versão mudar e o cliente aceitar de novo, o histórico fica.
CREATE TABLE IF NOT EXISTS aceites_diretrizes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  loja_id UUID NOT NULL REFERENCES lojas(id) ON DELETE CASCADE,
  versao TEXT NOT NULL,
  ip TEXT NOT NULL DEFAULT '',
  navegador TEXT NOT NULL DEFAULT '',
  aceito_em TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_aceites_diretrizes_loja ON aceites_diretrizes (loja_id, aceito_em DESC);
