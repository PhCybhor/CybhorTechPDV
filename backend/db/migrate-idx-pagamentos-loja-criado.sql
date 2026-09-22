-- Admin detalhar_loja: pagamentos por loja ordenados por data.
CREATE INDEX IF NOT EXISTS idx_pagamentos_loja_criado
  ON pagamentos (loja_id, criado_em DESC);
