from logging.config import fileConfig
from sqlalchemy import engine_from_config, pool, text
from alembic import context
import os, sys

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from app.database import Base
from app import models  # noqa: F401 — ensure all models are registered

config = context.config

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

target_metadata = Base.metadata


def get_url():
    from app.config import settings
    return settings.DATABASE_URL


def _patch_has_table(dialect):
    """
    Replace the MySQL/MariaDB has_table implementation with one that uses
    information_schema instead of DESCRIBE, which crashes MariaDB 10.4 on
    Windows when called against a freshly initialised InnoDB tablespace.
    """
    original_has_table = dialect.__class__.has_table

    def has_table(self, connection, table_name, schema=None, **kw):
        schema_name = schema or connection.engine.url.database
        result = connection.execute(
            text(
                "SELECT COUNT(*) FROM information_schema.tables "
                "WHERE table_schema = :schema AND table_name = :table"
            ),
            {"schema": schema_name, "table": table_name},
        )
        return result.scalar() > 0

    dialect.__class__.has_table = has_table


def run_migrations_offline() -> None:
    url = get_url()
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    from sqlalchemy import create_engine
    connectable = create_engine(get_url(), poolclass=pool.NullPool)
    with connectable.connect() as connection:
        _patch_has_table(connection.dialect)
        context.configure(connection=connection, target_metadata=target_metadata)
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
