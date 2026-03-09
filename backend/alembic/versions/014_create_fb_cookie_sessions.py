"""create fb_cookie_sessions table

Revision ID: 014
Revises: 013
Create Date: 2026-03-08

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID


# revision identifiers, used by Alembic.
revision = '014'
down_revision = '013'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        'fb_cookie_sessions',
        sa.Column('id', UUID(as_uuid=True), primary_key=True),
        sa.Column('tenant_id', UUID(as_uuid=True), sa.ForeignKey('tenants.id', ondelete='CASCADE'), nullable=False, index=True),
        sa.Column('user_id', UUID(as_uuid=True), sa.ForeignKey('users.id'), nullable=False),
        sa.Column('cookies_encrypted', sa.Text(), nullable=False),
        sa.Column('fb_user_id', sa.String(50)),
        sa.Column('is_valid', sa.Boolean(), server_default='true'),
        sa.Column('last_validated_at', sa.DateTime(timezone=True)),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.UniqueConstraint('tenant_id', name='uq_fb_cookie_session_tenant'),
    )


def downgrade():
    op.drop_table('fb_cookie_sessions')
