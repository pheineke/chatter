import asyncio
import sys
import os

# Add the parent directory to sys.path so we can import app and models
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy import select
from sqlalchemy.future import select as future_select 

# We need to make sure models are imported so sqlalchemy knows about them
from app.database import AsyncSessionLocal
from models.interaction import ApplicationCommand
# from models.user import User # This might be circular if imported from app?
from models.user import User 

async def main():
    print("Connecting to database...")
    async with AsyncSessionLocal() as session:
        # Find or create a bot user
        # Note: using future_select to match async usage
        result = await session.execute(select(User).where(User.username == "SystemBot"))
        bot = result.scalar_one_or_none()
        
        if not bot:
            print("Creating SystemBot user...")
            bot = User(
                username="SystemBot", 
                # Dummy hash for "$2b$12$EixZaYVK1fsbw1ZfbX3OXePaWrn3ILAWOiP0jo.z2taq9jLe/1.u2" (valid bcrypt output)
                password_hash="$2b$12$EixZaYVK1fsbw1ZfbX3OXePaWrn3ILAWOiP0jo.z2taq9jLe/1.u2",
                is_bot=True
            )
            session.add(bot)
            await session.commit()
            await session.refresh(bot)
            print(f"Created SystemBot with ID: {bot.id}")
        else:
            print(f"Using existing SystemBot ID: {bot.id}")

        # Define commands
        commands_to_add = [
            {
                "name": "ping",
                "description": "Replies with pong!",
                "options": [],
                "type": "CHAT_INPUT"
            },
            {
                "name": "echo",
                "description": "Echoes your message back",
                "options": [{"name": "message", "description": "The message to echo", "type": 3, "required": True}],
                "type": "CHAT_INPUT"
            }
        ]

        for cmd_data in commands_to_add:
            # Check if exists
            result = await session.execute(select(ApplicationCommand).where(ApplicationCommand.name == cmd_data["name"]))
            existing = result.scalar_one_or_none()
            if not existing:
                print(f"Creating command /{cmd_data['name']}")
                new_cmd = ApplicationCommand(
                    application_id=bot.id,
                    name=cmd_data["name"],
                    description=cmd_data["description"],
                    options=cmd_data["options"],
                    type=cmd_data["type"],
                    default_permission=True
                )
                session.add(new_cmd)
            else:
                print(f"Command /{cmd_data['name']} already exists")
        
        await session.commit()
        print("Done!")

if __name__ == "__main__":
    asyncio.run(main())
