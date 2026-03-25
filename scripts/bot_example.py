import asyncio
import os
import json
import httpx
import websockets
from typing import Optional

# Replace with a real User ID that the bot has a DM with, or a Server Channel ID
CHANNEL_ID = os.getenv("CHANNEL_ID", "REPLACE_WITH_YOUR_CHANNEL_ID")
# Replace with the user's generated API Token
API_TOKEN = os.getenv("BOT_TOKEN", "REPLACE_WITH_YOUR_API_TOKEN")

# Assuming local backend is running here
WS_URL = "ws://localhost:8000"
API_URL = "http://localhost:8000"

async def receive_events():
    """
    Connects to the WebSocket and listens for incoming real-time events.
    """
    # The token can be passed as a query string since bot tokens are valid
    ws_endpoint = f"{WS_URL}/ws/me?token={API_TOKEN}"
    
    print(f"[*] Connecting to {ws_endpoint}...")
    try:
        async with websockets.connect(ws_endpoint) as websocket:
            print("[*] Connected! Listening for real-time events...\n")
            while True:
                message = await websocket.recv()
                event = json.loads(message)
                
                event_type = event.get("type", "unknown")
                data = event.get("data", {})
                
                print(f"[EVENT] => {event_type}")
                
                if event_type == "message.created":
                    content = data.get("content", "")
                    author = data.get("author", {}).get("username", "Unknown")
                    print(f"      [Msg] {author}: {content}")
                    
                    # Example Auto-Reply
                    if content.strip() == "!ping":
                        print("      => Responding to !ping in the background...")
                        asyncio.create_task(send_message(data.get("channel_id"), "Pong! 🏓 (from Bot)"))

    except Exception as e:
        print(f"[!] WebSocket connection error: {e}")

async def send_message(channel_id: str, content: str):
    """
    Sends a message to the specified channel using the REST API.
    """
    headers = {
        "Authorization": f"Bot {API_TOKEN}",
        "Content-Type": "application/json"
    }
    payload = {
        "content": content
    }
    
    async with httpx.AsyncClient() as client:
        try:
            response = await client.post(
                f"{API_URL}/channels/{channel_id}/messages",
                headers=headers,
                json=payload
            )
            response.raise_for_status()
            print(f"      [Success] Sent message to {channel_id}")
        except httpx.HTTPStatusError as e:
            print(f"      [!] Failed to send message: {e.response.status_code} - {e.response.text}")
        except Exception as e:
            print(f"      [!] Connection error sending message: {e}")

async def main():
    if API_TOKEN == "REPLACE_WITH_YOUR_API_TOKEN":
        print("[!] Please set your BOT_TOKEN environment variable.")
        return

    # Check our own user identity
    async with httpx.AsyncClient() as client:
        try:
            res = await client.get(f"{API_URL}/me", headers={"Authorization": f"Bot {API_TOKEN}"})
            res.raise_for_status()
            me = res.json()
            print(f"[*] Authenticated as bot user: {me.get('username')}")
        except Exception as e:
            print(f"[!] Invalid bot token or offline server. {e}")
            return
            
    # Start WebSocket listener
    await receive_events()

if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\n[*] Shutting down bot...")
