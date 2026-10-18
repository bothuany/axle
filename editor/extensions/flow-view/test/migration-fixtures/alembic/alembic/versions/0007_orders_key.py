"""orders key"""
import sqlalchemy as sa
from alembic import op

revision = "0007"
down_revision = "0006"


def upgrade():
    op.add_column("orders", sa.Column("key", sa.String(40), nullable=True))
    op.drop_column("orders", "legacy_ref")
    op.alter_column("orders", "status", new_column_name="state")
    op.alter_column("orders", "total", type_=sa.Numeric(12, 2))
    op.create_table(
        "order_notes",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("body", sa.Text),
    )
    op.create_index("ix_orders_key", "orders", ["key"])
    op.rename_table("tmp_orders", "old_orders")
    with op.batch_alter_table("customers") as batch_op:
        batch_op.add_column(sa.Column("vip", sa.Boolean))
        batch_op.drop_column("legacy_flag")
    op.execute("ALTER TABLE invoices ADD COLUMN note text")


def downgrade():
    op.drop_column("orders", "key")
    op.drop_table("order_notes")
