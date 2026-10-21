import enum

from sqlalchemy import Column, ForeignKey, Integer, String
from sqlalchemy.orm import declarative_base, relationship, sessionmaker

Base = declarative_base()
SessionLocal = sessionmaker()


class OrderStatus(enum.Enum):
    NEW = "new"
    PAID = "paid"
    SHIPPED = "shipped"


class Customer(Base):
    __tablename__ = "customers"

    id = Column(Integer, primary_key=True)
    name = Column(String(80))
    orders = relationship("Order", back_populates="customer")


class Order(Base):
    __tablename__ = "orders"

    id = Column(Integer, primary_key=True)
    customer_id = Column(Integer, ForeignKey("customers.id"))
    status = Column(String(20))
    customer = relationship("Customer", back_populates="orders")
