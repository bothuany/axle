from dataclasses import dataclass

from .discount import DiscountPolicy
from .model import Money, Order


@dataclass
class ReceiptDto:
    order_id: int
    total: Money


class CheckoutService:
    def __init__(self, discounts: DiscountPolicy):
        self.discounts = discounts

    def checkout(self, order: Order) -> ReceiptDto:
        ...
