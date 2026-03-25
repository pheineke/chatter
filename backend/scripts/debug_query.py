import asyncio
import sys
import os

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy import select
from app.database import AsyncSessionLocal
from models.interaction import ApplicationCommand

async def main():
    async with AsyncSessionLocal() as session:
        # Test the query used in the router
        print("Testing query for global commands (server_id=None)...")
        stmt = select(ApplicationCommand).where(ApplicationCommand.server_id == None)
        result = await session.execute(stmt)
        cmds = result.scalars().all()
        print(f"Found {len(cmds)} commands: {[c.name for c in cmds]}")

        # Test with is_(None)
        print("Testing query with is_(None)...")
        stmt = select(ApplicationCommand).where(ApplicationCommand.server_id.is_(None))
        result = await session.execute(stmt)
        cmds = result.scalars().all()
        print(f"Found {len(cmds)} commands: {[c.name for c in cmds]}")

if __name__ == "__main__":
    asyncio.run(main())
