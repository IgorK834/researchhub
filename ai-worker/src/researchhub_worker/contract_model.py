"""Shared strict JSON conventions for internal and retrieval contracts."""
from pydantic import BaseModel, ConfigDict


def _camel_case(value: str) -> str:
    first, *rest = value.split('_')
    return first + ''.join(word.capitalize() for word in rest)


class ContractModel(BaseModel):
    model_config = ConfigDict(alias_generator=_camel_case, populate_by_name=True, extra='forbid', frozen=True)
