from .model import Money, Order


class DiscountPolicy:
    def apply(self, order: Order) -> Money:
        raise NotImplementedError


class PercentDiscount(DiscountPolicy):
    percent: int

    def apply(self, order: Order) -> Money:
        ...
