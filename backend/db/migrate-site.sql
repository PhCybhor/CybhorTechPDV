-- Migracao: campos para compra pelo site (lojas existentes)
ALTER TABLE lojas ADD COLUMN IF NOT EXISTS email TEXT NOT NULL DEFAULT '';
ALTER TABLE assinaturas ADD COLUMN IF NOT EXISTS token_ativacao TEXT UNIQUE;
ALTER TABLE lojas ADD COLUMN IF NOT EXISTS responsavel_nome TEXT NOT NULL DEFAULT '';
ALTER TABLE lojas ADD COLUMN IF NOT EXISTS responsavel_sobrenome TEXT NOT NULL DEFAULT '';
