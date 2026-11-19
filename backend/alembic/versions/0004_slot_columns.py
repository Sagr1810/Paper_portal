"""Add slot columns to paper_questions for template-mode

Revision ID: 0004_slot_columns
Revises: 0003_rebuild_questions
Create Date: 2025-01-01 00:04:00
"""
from alembic import op
import sqlalchemy as sa

revision = '0004_slot_columns'
down_revision = '0003_rebuild_questions'
branch_labels = None
depends_on = None


def upgrade():
    # Make question_id nullable (template-mode papers have no question_id)
    op.alter_column('paper_questions', 'question_id',
                    existing_type=sa.Integer(), nullable=True)

    # Extend choice_group to 100 chars
    op.alter_column('paper_questions', 'choice_group',
                    existing_type=sa.String(50),
                    type_=sa.String(100), existing_nullable=True)

    # Add slot-mode columns
    op.add_column('paper_questions', sa.Column('slot_id', sa.String(50), nullable=True))
    op.add_column('paper_questions', sa.Column('slot_label', sa.String(100), nullable=True))
    op.add_column('paper_questions', sa.Column('slot_question_text', sa.Text(), nullable=True))
    op.add_column('paper_questions', sa.Column('slot_co_id',
        sa.Integer(), sa.ForeignKey('course_outcomes.id'), nullable=True))
    op.add_column('paper_questions', sa.Column('slot_blooms_id',
        sa.Integer(), sa.ForeignKey('blooms_levels.id'), nullable=True))
    op.add_column('paper_questions', sa.Column('slot_unit_id',
        sa.Integer(), sa.ForeignKey('syllabus_units.id'), nullable=True))
    op.add_column('paper_questions', sa.Column('slot_difficulty',
        sa.Enum('easy', 'medium', 'hard', name='difficulty_enum'), nullable=True))


def downgrade():
    op.drop_column('paper_questions', 'slot_difficulty')
    op.drop_column('paper_questions', 'slot_unit_id')
    op.drop_column('paper_questions', 'slot_blooms_id')
    op.drop_column('paper_questions', 'slot_co_id')
    op.drop_column('paper_questions', 'slot_question_text')
    op.drop_column('paper_questions', 'slot_label')
    op.drop_column('paper_questions', 'slot_id')
    op.alter_column('paper_questions', 'question_id', nullable=False)
