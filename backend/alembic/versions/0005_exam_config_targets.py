"""Add co_targets and blooms_targets columns to exam_configurations

Revision ID: 0005_exam_config_targets
Revises: 0004_slot_columns
Create Date: 2025-01-01 00:05:00
"""
from alembic import op
import sqlalchemy as sa

revision = '0005_exam_config_targets'
down_revision = '0004_slot_columns'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('exam_configurations', sa.Column('co_targets', sa.JSON, nullable=True))
    op.add_column('exam_configurations', sa.Column('blooms_targets', sa.JSON, nullable=True))


def downgrade():
    op.drop_column('exam_configurations', 'blooms_targets')
    op.drop_column('exam_configurations', 'co_targets')
