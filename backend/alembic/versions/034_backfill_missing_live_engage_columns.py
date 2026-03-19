"""backfill all missing columns on fb_live_engage_sessions

This migration safely adds any columns that are in the model but missing
from the database. Handles the case where the table was created outside
of alembic (e.g. via metadata.create_all) with only some columns.

Revision ID: 034
Revises: 033
Create Date: 2026-03-20
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

revision = '034'
down_revision = '033'
branch_labels = None
depends_on = None


def _col_exists(table, column):
    conn = op.get_bind()
    return conn.execute(sa.text(
        f"SELECT EXISTS (SELECT FROM information_schema.columns "
        f"WHERE table_name = '{table}' AND column_name = '{column}')"
    )).scalar()


def upgrade():
    # All columns that should exist on fb_live_engage_sessions
    columns = [
        ('min_delay_seconds', 'INTEGER', '15'),
        ('max_delay_seconds', 'INTEGER', '60'),
        ('max_duration_minutes', 'INTEGER', '180'),
        ('total_comments_posted', 'INTEGER', '0'),
        ('total_errors', 'INTEGER', '0'),
        ('comments_by_role', 'JSONB', None),
        ('active_accounts', 'INTEGER', '0'),
        ('comments_monitored', 'INTEGER', '0'),
        ('scrape_interval_seconds', 'INTEGER', '8'),
        ('page_owner_id', 'VARCHAR(100)', None),
        ('product_codes', 'TEXT', None),
        ('code_pattern', 'VARCHAR(500)', None),
        ('quantity_variation', 'BOOLEAN', 'true'),
        ('aggressive_level', 'VARCHAR(10)', "'medium'"),
        ('direct_accounts_encrypted', 'TEXT', None),
        ('target_comments_enabled', 'BOOLEAN', 'false'),
        ('target_comments_count', 'INTEGER', None),
        ('target_comments_period_minutes', 'INTEGER', None),
        ('blacklist_words', 'TEXT', None),
        ('stream_end_threshold', 'INTEGER', '10'),
        ('live_metrics', 'JSONB', None),
        ('scheduled_at', 'TIMESTAMP WITH TIME ZONE', None),
    ]

    conn = op.get_bind()
    for col_name, col_type, default in columns:
        if not _col_exists('fb_live_engage_sessions', col_name):
            default_clause = f" DEFAULT {default}" if default else ""
            conn.execute(sa.text(
                f"ALTER TABLE fb_live_engage_sessions ADD COLUMN {col_name} {col_type}{default_clause}"
            ))

    # Make login_batch_id nullable if it isn't already
    conn.execute(sa.text(
        "ALTER TABLE fb_live_engage_sessions ALTER COLUMN login_batch_id DROP NOT NULL"
    ))


def downgrade():
    pass  # No safe downgrade — columns may have been there from creation
