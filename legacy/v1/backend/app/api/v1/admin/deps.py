from fastapi import Depends, HTTPException, status
from sqlmodel import Session, select

from app.api.deps import get_current_user, get_db
from app.models.user import User
from app.models.user_role import RoleType, UserRole


async def get_current_admin_user(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> User:
    """
    Dependency to ensure current user has admin role.
    """
    # Check if user has admin role
    stmt = select(UserRole).where(UserRole.user_id == current_user.id, UserRole.role == RoleType.ADMIN)
    admin_role = db.exec(stmt).first()

    if not admin_role:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin access required")

    return current_user
