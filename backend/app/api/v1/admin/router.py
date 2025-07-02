from fastapi import APIRouter

from .performance import router as performance_router
from .sp_management import router as sp_management_router

router = APIRouter(prefix="/admin", tags=["admin"])

# Include sub-routers
router.include_router(performance_router, prefix="/performance")
router.include_router(sp_management_router, prefix="/sp")
