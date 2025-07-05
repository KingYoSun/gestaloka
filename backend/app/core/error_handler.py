"""
統一エラーハンドラー
"""

from fastapi import Request, status
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.core.exceptions import LogverseError, to_http_exception
from app.core.logging import get_logger

logger = get_logger(__name__)


async def logverse_error_handler(request: Request, exc: LogverseError) -> JSONResponse:
    """
    カスタム例外のハンドラー
    """
    http_exc = to_http_exception(exc)

    logger.error(
        "Application error",
        error_code=exc.code,
        error_message=exc.message,
        error_details=exc.details,
        path=request.url.path,
        method=request.method,
    )

    return JSONResponse(status_code=http_exc.status_code, content=http_exc.detail)


async def http_exception_handler(request: Request, exc: StarletteHTTPException) -> JSONResponse:
    """
    HTTPExceptionのハンドラー
    """
    logger.warning(
        "HTTP exception", status_code=exc.status_code, detail=exc.detail, path=request.url.path, method=request.method
    )

    return JSONResponse(
        status_code=exc.status_code, content={"message": str(exc.detail), "code": f"HTTP_{exc.status_code}"}
    )


async def validation_exception_handler(request: Request, exc: RequestValidationError) -> JSONResponse:
    """
    バリデーションエラーのハンドラー
    """
    logger.warning("Validation error", errors=exc.errors(), path=request.url.path, method=request.method)

    errors = []
    for error in exc.errors():
        error_detail = {
            "type": error.get("type", ""),
            "loc": error.get("loc", []),
            "msg": error.get("msg", ""),
            "input": error.get("input"),
        }
        errors.append(error_detail)

    return JSONResponse(
        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
        content={"message": "Validation error", "code": "VALIDATION_ERROR", "details": errors},
    )


async def generic_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    """
    その他の例外のハンドラー
    """
    logger.exception("Unhandled exception", path=request.url.path, method=request.method)

    return JSONResponse(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        content={"message": "Internal server error", "code": "INTERNAL_ERROR"},
    )
