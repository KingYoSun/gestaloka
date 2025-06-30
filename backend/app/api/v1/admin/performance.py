from datetime import datetime, timedelta
from typing import List, Optional, Dict, Any
import asyncio

from fastapi import APIRouter, Depends, Query, HTTPException
from sqlmodel import Session, select, func
from pydantic import BaseModel

from app.api.deps import get_db
from app.models.user import User
from app.models.action_log import ActionLog
from app.services.game_session import GameSessionService
from app.services.ai.dispatch_interaction import DispatchInteractionService
from .deps import get_current_admin_user

router = APIRouter()


class PerformanceMetric(BaseModel):
    agent_name: str
    avg_execution_time: float
    min_execution_time: float
    max_execution_time: float
    total_calls: int
    model_type: Optional[str] = None


class PerformanceTestRequest(BaseModel):
    action_type: str = "explore"
    test_content: str = "周囲を探索する"
    iterations: int = 3


class PerformanceTestResult(BaseModel):
    test_id: str
    started_at: datetime
    completed_at: datetime
    total_duration: float
    iterations: int
    results: List[Dict[str, Any]]
    summary: Dict[str, PerformanceMetric]


class PerformanceStats(BaseModel):
    period_start: datetime
    period_end: datetime
    total_actions: int
    avg_response_time: float
    metrics_by_agent: List[PerformanceMetric]
    metrics_by_action_type: Dict[str, Dict[str, float]]


@router.get("/stats", response_model=PerformanceStats)
async def get_performance_stats(
    hours: int = Query(24, description="Number of hours to look back"),
    current_user: User = Depends(get_current_admin_user),
    db: Session = Depends(get_db)
):
    """
    Get AI performance statistics for the specified time period.
    """
    period_end = datetime.utcnow()
    period_start = period_end - timedelta(hours=hours)
    
    # Get action logs with performance data
    stmt = select(ActionLog).where(
        ActionLog.created_at >= period_start,
        ActionLog.performance_data.is_not(None)
    )
    action_logs = db.exec(stmt).all()
    
    if not action_logs:
        return PerformanceStats(
            period_start=period_start,
            period_end=period_end,
            total_actions=0,
            avg_response_time=0,
            metrics_by_agent=[],
            metrics_by_action_type={}
        )
    
    # Process performance data
    agent_metrics: Dict[str, List[float]] = {}
    action_type_metrics: Dict[str, List[float]] = {}
    total_response_times = []
    
    for log in action_logs:
        perf_data = log.performance_data or {}
        agents = perf_data.get("agents", {})
        
        # Collect agent metrics
        for agent_name, agent_data in agents.items():
            if agent_name not in agent_metrics:
                agent_metrics[agent_name] = []
            agent_metrics[agent_name].append(agent_data.get("execution_time", 0))
        
        # Collect action type metrics
        action_type = log.action_type
        total_time = perf_data.get("total_execution_time", 0)
        
        if action_type not in action_type_metrics:
            action_type_metrics[action_type] = []
        action_type_metrics[action_type].append(total_time)
        total_response_times.append(total_time)
    
    # Calculate aggregated metrics
    metrics_by_agent = []
    for agent_name, times in agent_metrics.items():
        if times:
            metrics_by_agent.append(PerformanceMetric(
                agent_name=agent_name,
                avg_execution_time=sum(times) / len(times),
                min_execution_time=min(times),
                max_execution_time=max(times),
                total_calls=len(times)
            ))
    
    # Calculate action type metrics
    metrics_by_action_type_result = {}
    for action_type, times in action_type_metrics.items():
        if times:
            metrics_by_action_type_result[action_type] = {
                "avg_time": sum(times) / len(times),
                "min_time": min(times),
                "max_time": max(times),
                "count": len(times)
            }
    
    return PerformanceStats(
        period_start=period_start,
        period_end=period_end,
        total_actions=len(action_logs),
        avg_response_time=sum(total_response_times) / len(total_response_times) if total_response_times else 0,
        metrics_by_agent=metrics_by_agent,
        metrics_by_action_type=metrics_by_action_type_result
    )


@router.post("/test", response_model=PerformanceTestResult)
async def run_performance_test(
    request: PerformanceTestRequest,
    current_user: User = Depends(get_current_admin_user),
    db: Session = Depends(get_db)
):
    """
    Run a performance test with specified parameters.
    """
    test_id = f"perf_test_{datetime.utcnow().strftime('%Y%m%d_%H%M%S')}"
    started_at = datetime.utcnow()
    
    # Get or create test session
    session_service = GameSessionService(db)
    sessions = await session_service.get_active_sessions(current_user.id)
    
    if not sessions:
        # Create a test session
        from app.models.character import Character
        from app.schemas.game_session import GameSessionCreate
        
        # Get or create test character
        stmt = select(Character).where(Character.user_id == current_user.id)
        character = db.exec(stmt).first()
        
        if not character:
            raise HTTPException(
                status_code=400,
                detail="No character found. Please create a character first."
            )
        
        # Create session
        session_data = GameSessionCreate(character_id=character.id)
        session = await session_service.create_session(current_user.id, session_data)
    else:
        session = sessions[0]
    
    # Run performance tests
    results = []
    dispatch_service = DispatchInteractionService()
    
    for i in range(request.iterations):
        iteration_start = datetime.utcnow()
        
        try:
            # Execute action
            action_result = await dispatch_service.handle_player_action(
                db=db,
                session_id=session.id,
                action_type=request.action_type,
                action_content=request.test_content
            )
            
            iteration_end = datetime.utcnow()
            iteration_duration = (iteration_end - iteration_start).total_seconds()
            
            # Get performance data from the last action log
            stmt = select(ActionLog).where(
                ActionLog.session_id == session.id
            ).order_by(ActionLog.created_at.desc())
            last_log = db.exec(stmt).first()
            
            results.append({
                "iteration": i + 1,
                "duration": iteration_duration,
                "performance_data": last_log.performance_data if last_log else {},
                "success": True
            })
            
        except Exception as e:
            results.append({
                "iteration": i + 1,
                "duration": 0,
                "error": str(e),
                "success": False
            })
        
        # Small delay between iterations
        if i < request.iterations - 1:
            await asyncio.sleep(1)
    
    completed_at = datetime.utcnow()
    total_duration = (completed_at - started_at).total_seconds()
    
    # Calculate summary metrics
    agent_summary: Dict[str, List[float]] = {}
    
    for result in results:
        if result["success"] and result.get("performance_data"):
            agents = result["performance_data"].get("agents", {})
            for agent_name, agent_data in agents.items():
                if agent_name not in agent_summary:
                    agent_summary[agent_name] = []
                agent_summary[agent_name].append(agent_data.get("execution_time", 0))
    
    summary = {}
    for agent_name, times in agent_summary.items():
        if times:
            summary[agent_name] = PerformanceMetric(
                agent_name=agent_name,
                avg_execution_time=sum(times) / len(times),
                min_execution_time=min(times),
                max_execution_time=max(times),
                total_calls=len(times),
                model_type=results[0]["performance_data"]["agents"][agent_name].get("model_type") if results and results[0]["success"] else None
            )
    
    return PerformanceTestResult(
        test_id=test_id,
        started_at=started_at,
        completed_at=completed_at,
        total_duration=total_duration,
        iterations=request.iterations,
        results=results,
        summary=summary
    )


@router.get("/realtime")
async def get_realtime_metrics(
    current_user: User = Depends(get_current_admin_user),
    db: Session = Depends(get_db)
):
    """
    Get real-time performance metrics (last 5 minutes).
    """
    cutoff_time = datetime.utcnow() - timedelta(minutes=5)
    
    stmt = select(ActionLog).where(
        ActionLog.created_at >= cutoff_time,
        ActionLog.performance_data.is_not(None)
    ).order_by(ActionLog.created_at.desc()).limit(50)
    
    recent_logs = db.exec(stmt).all()
    
    metrics = []
    for log in recent_logs:
        perf_data = log.performance_data or {}
        metrics.append({
            "timestamp": log.created_at,
            "session_id": log.session_id,
            "action_type": log.action_type,
            "total_time": perf_data.get("total_execution_time", 0),
            "agents": perf_data.get("agents", {})
        })
    
    return {
        "metrics": metrics,
        "count": len(metrics),
        "period_start": cutoff_time,
        "period_end": datetime.utcnow()
    }