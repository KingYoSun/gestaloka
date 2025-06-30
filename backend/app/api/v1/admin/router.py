from fastapi import APIRouter

from .performance import router as performance_router

router = APIRouter(prefix="/admin", tags=["admin"])

# Include sub-routers
router.include_router(performance_router, prefix="/performance")