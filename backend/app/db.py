from __future__ import annotations

from contextlib import contextmanager
from typing import Any, Generator, List, Optional, Sequence

import psycopg2
import psycopg2.extras
from psycopg2.extensions import connection as PgConnection
from psycopg2.pool import ThreadedConnectionPool

from app.config import get_settings

_pool: Optional[ThreadedConnectionPool] = None


def _limites_pool(settings) -> tuple[int, int]:
    minimo = max(1, int(settings.db_pool_min or 1))
    maximo = max(minimo, int(settings.db_pool_max or minimo))
    return minimo, maximo


def init_pool() -> None:
    global _pool
    if _pool is None:
        settings = get_settings()
        minimo, maximo = _limites_pool(settings)
        _pool = ThreadedConnectionPool(
            minimo,
            maximo,
            dsn=settings.database_url,
            keepalives=1,
            keepalives_idle=30,
            keepalives_interval=10,
            keepalives_count=5,
        )


def close_pool() -> None:
    global _pool
    if _pool is not None:
        _pool.closeall()
        _pool = None


@contextmanager
def obter_conexao() -> Generator[PgConnection, None, None]:
    if _pool is None:
        init_pool()
    assert _pool is not None
    conn = _pool.getconn()
    try:
        # Conexao morta (firewall/idle) nao volta ao pool.
        if getattr(conn, "closed", 0):
            _pool.putconn(conn, close=True)
            conn = _pool.getconn()
        yield conn
    except Exception:
        # Evita devolver conexão em estado "aborted" ao pool.
        try:
            conn.rollback()
        except Exception:
            pass
        raise
    finally:
        _pool.putconn(conn)


def consultar(sql: str, params: Sequence[Any] = ()) -> List[dict]:
    """Executa SELECT/INSERT…RETURNING e devolve linhas como dict."""
    with obter_conexao() as conn:
        try:
            with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
                cur.execute(sql, params)
                if cur.description is None:
                    conn.commit()
                    return []
                rows = cur.fetchall()
                conn.commit()
                return [dict(r) for r in rows]
        except Exception:
            conn.rollback()
            raise


def executar(sql: str, params: Sequence[Any] = ()) -> int:
    """Executa INSERT/UPDATE/DELETE e devolve rowcount."""
    with obter_conexao() as conn:
        try:
            with conn.cursor() as cur:
                cur.execute(sql, params)
                afetadas = cur.rowcount
                conn.commit()
                return afetadas
        except Exception:
            conn.rollback()
            raise


@contextmanager
def transacao() -> Generator[psycopg2.extensions.cursor, None, None]:
    """Cursor dentro de BEGIN/COMMIT — para baixa de estoque atômica."""
    with obter_conexao() as conn:
        try:
            with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
                cur.execute("BEGIN")
                yield cur
                conn.commit()
        except Exception:
            conn.rollback()
            raise
