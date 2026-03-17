"""add access_token_encrypted to fb_login_results

Revision ID: 023
Revises: 022
Create Date: 2026-03-17
"""
from alembic import op
import sqlalchemy as sa

revision = '023'
down_revision = '022'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('fb_login_results', sa.Column('access_token_encrypted', sa.Text()))


def downgrade():
    op.drop_column('fb_login_results', 'access_token_encrypted')
