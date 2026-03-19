"""create fb_live_engage_sessions and fb_live_engage_logs tables if not exist

Revision ID: 026a
Revises: 026
Create Date: 2026-03-17
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB, UUID

revision = '026a'
down_revision = '026'
branch_labels = None
depends_on = None


def upgrade():
    conn = op.get_bind()

    # Check if table already exists
    result = conn.execute(sa.text(
        "SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'fb_live_engage_sessions')"
    ))
    table_exists = result.scalar()

    if not table_exists:
        op.create_table(
            'fb_live_engage_sessions',
            sa.Column('id', UUID(as_uuid=True), primary_key=True),
            sa.Column('tenant_id', UUID(as_uuid=True), sa.ForeignKey('tenants.id', ondelete='CASCADE'), nullable=False),
            sa.Column('user_id', UUID(as_uuid=True), sa.ForeignKey('users.id'), nullable=False),
            sa.Column('login_batch_id', UUID(as_uuid=True), sa.ForeignKey('fb_login_batches.id'), nullable=True),
            sa.Column('post_id', sa.String(200), nullable=False),
            sa.Column('post_url', sa.String(500)),
            sa.Column('title', sa.String(500)),
            sa.Column('status', sa.String(20), nullable=False, server_default='running'),
            sa.Column('celery_task_id', sa.String(255)),
            sa.Column('error_message', sa.Text()),
            sa.Column('role_distribution', JSONB()),
            sa.Column('business_context', sa.Text(), server_default=''),
            sa.Column('training_comments', sa.Text()),
            sa.Column('ai_instructions', sa.Text(), server_default=''),
            sa.Column('product_codes', sa.Text()),
            sa.Column('page_owner_id', sa.String(100)),
            sa.Column('scrape_interval_seconds', sa.Integer(), server_default='8'),
            sa.Column('min_delay_seconds', sa.Integer(), server_default='15'),
            sa.Column('max_delay_seconds', sa.Integer(), server_default='60'),
            sa.Column('max_duration_minutes', sa.Integer(), server_default='180'),
            sa.Column('total_comments_posted', sa.Integer(), server_default='0'),
            sa.Column('total_errors', sa.Integer(), server_default='0'),
            sa.Column('comments_by_role', JSONB()),
            sa.Column('active_accounts', sa.Integer(), server_default='0'),
            sa.Column('comments_monitored', sa.Integer(), server_default='0'),
            sa.Column('started_at', sa.DateTime(timezone=True)),
            sa.Column('ended_at', sa.DateTime(timezone=True)),
            sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        )
        op.create_index('ix_fb_live_engage_sessions_tenant_status', 'fb_live_engage_sessions', ['tenant_id', 'status'])
    else:
        # Table exists but may be missing columns — add them safely
        for col_name, col_type, default in [
            ('min_delay_seconds', 'INTEGER', '15'),
            ('max_delay_seconds', 'INTEGER', '60'),
            ('max_duration_minutes', 'INTEGER', '180'),
            ('total_comments_posted', 'INTEGER', '0'),
            ('total_errors', 'INTEGER', '0'),
            ('comments_by_role', 'JSONB', None),
            ('active_accounts', 'INTEGER', '0'),
            ('comments_monitored', 'INTEGER', '0'),
        ]:
            col_exists = conn.execute(sa.text(
                f"SELECT EXISTS (SELECT FROM information_schema.columns "
                f"WHERE table_name = 'fb_live_engage_sessions' AND column_name = '{col_name}')"
            )).scalar()
            if not col_exists:
                default_clause = f" DEFAULT {default}" if default else ""
                conn.execute(sa.text(
                    f"ALTER TABLE fb_live_engage_sessions ADD COLUMN {col_name} {col_type}{default_clause}"
                ))

    # Check if logs table exists
    result = conn.execute(sa.text(
        "SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'fb_live_engage_logs')"
    ))
    logs_exists = result.scalar()

    if not logs_exists:
        op.create_table(
            'fb_live_engage_logs',
            sa.Column('id', UUID(as_uuid=True), primary_key=True),
            sa.Column('session_id', UUID(as_uuid=True), sa.ForeignKey('fb_live_engage_sessions.id', ondelete='CASCADE'), nullable=False),
            sa.Column('role', sa.String(30), nullable=False),
            sa.Column('content', sa.Text(), nullable=False),
            sa.Column('account_email', sa.String(255), nullable=False),
            sa.Column('reference_comment', sa.Text()),
            sa.Column('status', sa.String(20), nullable=False),
            sa.Column('error_message', sa.Text()),
            sa.Column('response_data', JSONB()),
            sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        )
        op.create_index('ix_fb_live_engage_logs_session_created', 'fb_live_engage_logs', ['session_id', 'created_at'])


def downgrade():
    op.drop_table('fb_live_engage_logs')
    op.drop_table('fb_live_engage_sessions')
