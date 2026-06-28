from fastapi import APIRouter
from sqlalchemy import select

from ..deps import Depends, get_current_user, get_db
from ..models import GraphEdge, GraphNode
from ..schemas import GraphOut

router = APIRouter(prefix="/graph", tags=["graph"])


@router.get("", response_model=GraphOut)
async def get_graph(meeting_id: str | None = None, db=Depends(get_db), _=Depends(get_current_user)):
    """Return the execution graph. Pass ?meeting_id to scope it to one meeting's flow."""
    node_q = select(GraphNode)
    edge_q = select(GraphEdge)
    if meeting_id:
        node_q = node_q.where(GraphNode.id.like(f"g_{meeting_id}_%"))
        edge_q = edge_q.where(GraphEdge.id.like(f"e_{meeting_id}_%"))
    nodes = (await db.execute(node_q)).scalars().all()
    edges = (await db.execute(edge_q)).scalars().all()
    return {"nodes": nodes, "edges": edges}
