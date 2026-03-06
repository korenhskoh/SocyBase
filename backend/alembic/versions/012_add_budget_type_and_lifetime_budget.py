"""add budget_type and lifetime_budget to ai_campaigns

Revision ID: 012
Revises: 011
Create Date: 2026-03-06

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '012'
down_revision = '011'
branch_labels = None
depends_on = None


def upgrade():
    # Add budget_type column (default DAILY for existing rows)
    op.add_column('ai_campaigns', sa.Column('budget_type', sa.String(length=20), nullable=False, server_default='DAILY'))

    # Add lifetime_budget column
    op.add_column('ai_campaigns', sa.Column('lifetime_budget', sa.Integer(), nullable=True))

    # Make daily_budget nullable (since we now support lifetime budget as alternative)
    op.alter_column('ai_campaigns', 'daily_budget',
                   existing_type=sa.INTEGER(),
                   nullable=True)


def downgrade():
    # Restore daily_budget as NOT NULL
    op.alter_column('ai_campaigns', 'daily_budget',
                   existing_type=sa.INTEGER(),
                   nullable=False)

    # Remove the new columns
    op.drop_column('ai_campaigns', 'lifetime_budget')
    op.drop_column('ai_campaigns', 'budget_type')
