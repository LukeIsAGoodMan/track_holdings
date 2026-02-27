"""
Shared Pydantic type aliases.

DecStr: Decimal in Python, serialized as string in JSON.
Rationale: preserves exact precision (no float rounding) and
lets the frontend format with toLocaleString / toFixed.
"""
from decimal import Decimal
from typing import Annotated

from pydantic import PlainSerializer

# Decimal → str in JSON only; still Decimal in Python code.
DecStr = Annotated[
    Decimal,
    PlainSerializer(lambda x: str(x), return_type=str, when_used="json"),
]
