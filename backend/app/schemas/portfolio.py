from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.base import DecStr


class PortfolioCreate(BaseModel):
    name:        str = Field(..., min_length=1, max_length=100)
    description: str | None = None
    parent_id:   int | None = None


class PortfolioNode(BaseModel):
    """
    One node in the portfolio tree.
    'children' is populated when building the tree response.
    """
    model_config = ConfigDict(arbitrary_types_allowed=True)

    id:                   int
    name:                 str
    description:          str | None
    parent_id:            int | None
    total_cash:           DecStr
    total_delta_exposure: DecStr
    total_margin:         DecStr
    children:             list[PortfolioNode] = []


# Self-referential model needs rebuild in Pydantic v2
PortfolioNode.model_rebuild()
