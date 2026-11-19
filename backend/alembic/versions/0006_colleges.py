"""Add colleges; departments and users belong to a college

Revision ID: 0006_colleges
Revises: 0005_exam_config_targets
Create Date: 2025-01-01 00:06:00
"""
from alembic import op
import sqlalchemy as sa

revision = "0006_colleges"
down_revision = "0005_exam_config_targets"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()

    op.create_table(
        "colleges",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("name", sa.String(255), nullable=False, unique=True),
        sa.Column("is_active", sa.Boolean, nullable=False, server_default="1"),
        sa.Column("created_at", sa.DateTime, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime, server_default=sa.func.now()),
    )

    op.add_column("departments", sa.Column("college_id", sa.Integer, nullable=True))
    op.add_column("users", sa.Column("college_id", sa.Integer, nullable=True))
    op.create_foreign_key("fk_departments_college", "departments", "colleges", ["college_id"], ["id"])
    op.create_foreign_key("fk_users_college", "users", "colleges", ["college_id"], ["id"])

    # Department names are now unique per college, not globally.
    insp = sa.inspect(bind)
    old_unique = set()
    for uc in insp.get_unique_constraints("departments"):
        if uc["column_names"] == ["name"] and uc.get("name"):
            old_unique.add(uc["name"])
    for ix in insp.get_indexes("departments"):
        if ix.get("unique") and ix["column_names"] == ["name"] and ix.get("name"):
            old_unique.add(ix["name"])
    for name in old_unique:
        op.drop_constraint(name, "departments", type_="unique")
    op.create_unique_constraint("uq_department_college_name", "departments", ["college_id", "name"])

    # Existing data: put everything into one starter college so nothing is orphaned.
    n_dept = bind.execute(sa.text("SELECT COUNT(*) FROM departments")).scalar()
    n_user = bind.execute(sa.text("SELECT COUNT(*) FROM users WHERE role <> 'owner'")).scalar()
    if n_dept or n_user:
        bind.execute(sa.text("INSERT INTO colleges (name, is_active) VALUES ('Default College', 1)"))
        cid = bind.execute(sa.text("SELECT id FROM colleges WHERE name = 'Default College'")).scalar()
        bind.execute(sa.text("UPDATE departments SET college_id = :c"), {"c": cid})
        bind.execute(sa.text("UPDATE users SET college_id = :c WHERE role <> 'owner'"), {"c": cid})
        # principal and exam cell belong to a college only
        bind.execute(sa.text("UPDATE users SET department_id = NULL WHERE role IN ('principal', 'exam_cell')"))


def downgrade() -> None:
    # MySQL uses the composite unique index to back the college FK, so drop the FKs first.
    op.drop_constraint("fk_users_college", "users", type_="foreignkey")
    op.drop_constraint("fk_departments_college", "departments", type_="foreignkey")
    op.drop_constraint("uq_department_college_name", "departments", type_="unique")
    op.create_unique_constraint("name", "departments", ["name"])
    op.drop_column("users", "college_id")
    op.drop_column("departments", "college_id")
    op.drop_table("colleges")
