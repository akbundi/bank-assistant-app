from fastapi import FastAPI, APIRouter, HTTPException
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import logging
from pathlib import Path
from pydantic import BaseModel, Field, ConfigDict
from typing import List, Optional
import uuid
from datetime import datetime, timezone
from emergentintegrations.llm.chat import LlmChat, UserMessage
import secrets
import random

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

# MongoDB connection
mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

# Create the main app
app = FastAPI()
api_router = APIRouter(prefix="/api")

# LLM Chat Configuration
EMERGENT_KEY = os.environ.get('EMERGENT_LLM_KEY')

# Models
class User(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    phone: str
    name: str
    pin: str
    balance: float = 50000.0
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

class OTPRequest(BaseModel):
    phone: str

class OTPVerify(BaseModel):
    phone: str
    otp: str

class LoginRequest(BaseModel):
    phone: str
    pin: str

class Transaction(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    user_id: str
    type: str  # credit, debit, transfer
    amount: float
    description: str
    balance_after: float
    timestamp: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

class TransferRequest(BaseModel):
    to_phone: str
    amount: float
    user_id: str

class ChatRequest(BaseModel):
    message: str
    user_id: str
    session_id: str

# Mock OTP storage
otp_store = {}

@api_router.get("/")
async def root():
    return {"message": "AI Voice Banking Assistant API"}

@api_router.post("/auth/send-otp")
async def send_otp(request: OTPRequest):
    """Send OTP to phone number"""
    try:
        # Generate 6-digit OTP
        otp = str(random.randint(100000, 999999))
        otp_store[request.phone] = otp
        
        # In production, integrate Twilio here
        print(f"OTP for {request.phone}: {otp}")
        
        return {
            "success": True,
            "message": "OTP sent successfully",
            "mock_otp": otp  # Remove in production
        }
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@api_router.post("/auth/verify-otp")
async def verify_otp(request: OTPVerify):
    """Verify OTP and check if user exists"""
    stored_otp = otp_store.get(request.phone)
    
    if not stored_otp or stored_otp != request.otp:
        raise HTTPException(status_code=400, detail="Invalid OTP")
    
    # Check if user exists
    user_doc = await db.users.find_one({"phone": request.phone}, {"_id": 0})
    
    if user_doc:
        if isinstance(user_doc.get('created_at'), str):
            user_doc['created_at'] = datetime.fromisoformat(user_doc['created_at'])
        return {
            "success": True,
            "user_exists": True,
            "user": user_doc
        }
    
    return {
        "success": True,
        "user_exists": False
    }

@api_router.post("/auth/register")
async def register(user: User):
    """Register new user"""
    # Check if user already exists
    existing = await db.users.find_one({"phone": user.phone})
    if existing:
        raise HTTPException(status_code=400, detail="User already exists")
    
    doc = user.model_dump()
    doc['created_at'] = doc['created_at'].isoformat()
    
    await db.users.insert_one(doc)
    return {"success": True, "user": user}

@api_router.post("/auth/login")
async def login(request: LoginRequest):
    """Login with phone and PIN"""
    user_doc = await db.users.find_one({"phone": request.phone, "pin": request.pin}, {"_id": 0})
    
    if not user_doc:
        raise HTTPException(status_code=401, detail="Invalid credentials")
    
    if isinstance(user_doc.get('created_at'), str):
        user_doc['created_at'] = datetime.fromisoformat(user_doc['created_at'])
    
    return {"success": True, "user": user_doc}

@api_router.get("/user/{user_id}/balance")
async def get_balance(user_id: str):
    """Get user balance"""
    user = await db.users.find_one({"id": user_id}, {"_id": 0})
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    
    return {"balance": user['balance']}

@api_router.get("/user/{user_id}/transactions")
async def get_transactions(user_id: str, limit: int = 10):
    """Get user transactions"""
    transactions = await db.transactions.find(
        {"user_id": user_id}, 
        {"_id": 0}
    ).sort("timestamp", -1).limit(limit).to_list(limit)
    
    for txn in transactions:
        if isinstance(txn.get('timestamp'), str):
            txn['timestamp'] = datetime.fromisoformat(txn['timestamp'])
    
    return {"transactions": transactions}

@api_router.post("/transfer")
async def transfer_money(request: TransferRequest):
    """Transfer money to another user"""
    # Get sender
    sender = await db.users.find_one({"id": request.user_id})
    if not sender:
        raise HTTPException(status_code=404, detail="Sender not found")
    
    # Check balance
    if sender['balance'] < request.amount:
        raise HTTPException(status_code=400, detail="Insufficient balance")
    
    # Get receiver
    receiver = await db.users.find_one({"phone": request.to_phone})
    if not receiver:
        raise HTTPException(status_code=404, detail="Receiver not found")
    
    # Update balances
    new_sender_balance = sender['balance'] - request.amount
    new_receiver_balance = receiver['balance'] + request.amount
    
    await db.users.update_one(
        {"id": request.user_id},
        {"$set": {"balance": new_sender_balance}}
    )
    
    await db.users.update_one(
        {"phone": request.to_phone},
        {"$set": {"balance": new_receiver_balance}}
    )
    
    # Create transactions
    sender_txn = Transaction(
        user_id=request.user_id,
        type="transfer_out",
        amount=request.amount,
        description=f"Transfer to {request.to_phone}",
        balance_after=new_sender_balance
    )
    
    receiver_txn = Transaction(
        user_id=receiver['id'],
        type="transfer_in",
        amount=request.amount,
        description=f"Transfer from {sender['phone']}",
        balance_after=new_receiver_balance
    )
    
    sender_doc = sender_txn.model_dump()
    sender_doc['timestamp'] = sender_doc['timestamp'].isoformat()
    
    receiver_doc = receiver_txn.model_dump()
    receiver_doc['timestamp'] = receiver_doc['timestamp'].isoformat()
    
    await db.transactions.insert_one(sender_doc)
    await db.transactions.insert_one(receiver_doc)
    
    return {
        "success": True,
        "new_balance": new_sender_balance,
        "transaction": sender_txn
    }

@api_router.post("/chat")
async def chat_with_ai(request: ChatRequest):
    """Chat with AI assistant for banking operations"""
    try:
        # Get user info
        user = await db.users.find_one({"id": request.user_id}, {"_id": 0})
        if not user:
            raise HTTPException(status_code=404, detail="User not found")
        
        # System message with banking context
        system_message = f"""You are VoiceBank AI, a helpful banking assistant for {user['name']}.
        
User's current balance: ₹{user['balance']:,.2f}
User's phone: {user['phone']}

You can help with:
- Checking account balance
- Viewing recent transactions
- Making fund transfers (ask for recipient phone and amount)
- Answering questions about banking services
- Setting reminders
- Providing interest rate information

Always be concise, friendly, and secure. For transfers, confirm details before processing.
Speak naturally in English or Hindi based on user preference.
If user asks to transfer money, respond with: "TRANSFER_REQUEST: phone_number, amount"""
        
        # Initialize chat
        chat = LlmChat(
            api_key=EMERGENT_KEY,
            session_id=request.session_id,
            system_message=system_message
        ).with_model("openai", "gpt-4o-mini")
        
        # Send message
        user_message = UserMessage(text=request.message)
        response = await chat.send_message(user_message)
        
        return {
            "success": True,
            "response": response,
            "user_balance": user['balance']
        }
    except Exception as e:
        print(f"Chat error: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

# Include router
app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get('CORS_ORIGINS', '*').split(','),
    allow_methods=["*"],
    allow_headers=["*"],
)

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()