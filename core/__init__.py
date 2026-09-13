"""LA Helper core — exact-rational linear algebra with zero web dependencies."""
from .matrix import Matrix
from . import ops
from . import lu
from . import solve
from . import det_rank
from . import inverse
from . import eigen
from .engine import compute, MAX_DIM

__version__ = "0.2.0"

__all__ = [
    "Matrix",
    "ops",
    "lu",
    "solve",
    "det_rank",
    "inverse",
    "eigen",
    "compute",
    "MAX_DIM",
]
