from fastapi import APIRouter

from app.api.routes.auth import router as auth_router
from app.api.routes.health import router as health_router
from app.api.routes.ops import router as ops_router
from app.api.routes.sessions import router as sessions_router
from app.api.routes.turns import router as turns_router
from app.api.routes.worlds import router as worlds_router

router = APIRouter()
router.include_router(health_router)
router.include_router(auth_router)
router.include_router(sessions_router)
router.include_router(turns_router)
router.include_router(worlds_router)
router.include_router(ops_router)
