from sqlalchemy import Column, Integer, String
from sqlalchemy.orm import declarative_base, sessionmaker

Base = declarative_base()
SessionLocal = sessionmaker()


class Invoice(Base):
    __tablename__ = "invoices"

    id = Column(Integer, primary_key=True)
    order_id = Column(Integer, nullable=False)
    customer_email = Column(String(120), nullable=False)
    status = Column(String(20))
    discount_code = Column(String(24))
    discount_cents = Column(Integer, default=0)
