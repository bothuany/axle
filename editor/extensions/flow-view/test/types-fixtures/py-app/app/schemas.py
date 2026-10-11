from enum import Enum
from typing import List, Optional
from pydantic import BaseModel
from dataclasses import dataclass


class Color(Enum):
    RED = 1
    BLUE = 2


class Address(BaseModel):
    street: str
    city: str


class ItemOut(BaseModel):
    sku: str
    color: Color


class UserOut(BaseModel):
    id: int
    address: Optional[Address] = None
    items: List[ItemOut] = []
    friends: list["UserOut"] = []


@dataclass
class Point:
    x: int
    y: int
