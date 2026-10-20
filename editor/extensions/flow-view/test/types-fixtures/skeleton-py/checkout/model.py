from dataclasses import dataclass
from typing import List


@dataclass
class Money:
    cents: int


@dataclass
class OrderLine:
    sku: str
    qty: int


@dataclass
class Order:
    id: int
    lines: List[OrderLine]

    def total(self) -> Money:
        ...

    def _line_count(self) -> int:
        return len(self.lines)
