import { useState, useEffect, useRef } from 'react';
import '@/App.css';
import axios from 'axios';
import { Mic, MicOff, Send, Phone, Lock, User, TrendingUp, ArrowUpRight, ArrowDownLeft, Clock, IndianRupee } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import { toast } from 'sonner';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

function App() {
  const [stage, setStage] = useState('auth'); // auth, register, dashboard
  const [phone, setPhone] = useState('');
  const [otp, setOtp] = useState('');
  const [pin, setPin] = useState('');
  const [name, setName] = useState('');
  const [user, setUser] = useState(null);
  const [isListening, setIsListening] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [messages, setMessages] = useState([]);
  const [inputMessage, setInputMessage] = useState('');
  const [balance, setBalance] = useState(0);
  const [transactions, setTransactions] = useState([]);
  const [sessionId] = useState(() => 'session_' + Date.now());
  const recognitionRef = useRef(null);
  const synthRef = useRef(window.speechSynthesis);
  const messagesEndRef = useRef(null);

  useEffect(() => {
    if ('webkitSpeechRecognition' in window) {
      const recognition = new window.webkitSpeechRecognition();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = 'en-IN';

      recognition.onresult = (event) => {
        let finalTranscript = '';
        for (let i = event.resultIndex; i < event.results.length; i++) {
          if (event.results[i].isFinal) {
            finalTranscript += event.results[i][0].transcript;
          }
        }
        if (finalTranscript) {
          setTranscript(finalTranscript);
          setInputMessage(finalTranscript);
        }
      };

      recognition.onerror = (event) => {
        console.error('Speech recognition error:', event.error);
        setIsListening(false);
      };

      recognition.onend = () => {
        setIsListening(false);
      };

      recognitionRef.current = recognition;
    }
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const speak = (text) => {
    if (synthRef.current) {
      synthRef.current.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = 'en-IN';
      utterance.rate = 1.0;
      synthRef.current.speak(utterance);
    }
  };

  const toggleListening = () => {
    if (isListening) {
      recognitionRef.current?.stop();
      setIsListening(false);
    } else {
      recognitionRef.current?.start();
      setIsListening(true);
    }
  };

  const sendOTP = async () => {
    try {
      const response = await axios.post(`${API}/auth/send-otp`, { phone });
      toast.success(`OTP sent: ${response.data.mock_otp}`);
      setStage('verify-otp');
    } catch (error) {
      toast.error('Failed to send OTP');
    }
  };

  const verifyOTP = async () => {
    try {
      const response = await axios.post(`${API}/auth/verify-otp`, { phone, otp });
      console.log('OTP Verify Response:', response.data);
      
      if (response.data.success) {
        toast.success('OTP verified!');
        if (response.data.user_exists) {
          setStage('login');
        } else {
          setStage('register');
        }
      } else {
        toast.error('Invalid OTP');
      }
    } catch (error) {
      console.error('OTP verification error:', error);
      toast.error('Invalid OTP');
    }
  };

  const register = async () => {
    try {
      const response = await axios.post(`${API}/auth/register`, {
        phone,
        name,
        pin
      });
      setUser(response.data.user);
      setBalance(response.data.user.balance);
      setStage('dashboard');
      toast.success('Account created successfully!');
      speak('Welcome to VoiceBank AI. Your account has been created successfully.');
      loadDashboard(response.data.user.id);
    } catch (error) {
      toast.error('Registration failed');
    }
  };

  const login = async () => {
    try {
      const response = await axios.post(`${API}/auth/login`, { phone, pin });
      setUser(response.data.user);
      setBalance(response.data.user.balance);
      setStage('dashboard');
      toast.success('Login successful!');
      speak(`Welcome back ${response.data.user.name}. Your current balance is ${response.data.user.balance} rupees.`);
      loadDashboard(response.data.user.id);
    } catch (error) {
      toast.error('Invalid credentials');
    }
  };

  const loadDashboard = async (userId) => {
    try {
      const txnResponse = await axios.get(`${API}/user/${userId}/transactions?limit=5`);
      setTransactions(txnResponse.data.transactions);
    } catch (error) {
      console.error('Failed to load transactions');
    }
  };

  const sendMessage = async () => {
    if (!inputMessage.trim()) return;

    const userMsg = { role: 'user', content: inputMessage };
    setMessages(prev => [...prev, userMsg]);
    setInputMessage('');
    setTranscript('');

    try {
      const response = await axios.post(`${API}/chat`, {
        message: inputMessage,
        user_id: user.id,
        session_id: sessionId
      });

      const aiMsg = { role: 'assistant', content: response.data.response };
      setMessages(prev => [...prev, aiMsg]);
      setBalance(response.data.user_balance);
      speak(response.data.response);

      // Refresh transactions if needed
      if (inputMessage.toLowerCase().includes('transaction') || inputMessage.toLowerCase().includes('transfer')) {
        loadDashboard(user.id);
      }
    } catch (error) {
      toast.error('Failed to send message');
      const errorMsg = { role: 'assistant', content: 'Sorry, I encountered an error. Please try again.' };
      setMessages(prev => [...prev, errorMsg]);
    }
  };

  const renderAuth = () => (
    <div className="auth-container">
      <div className="auth-card">
        <div className="auth-header">
          <div className="logo-circle">
            <Phone className="logo-icon" />
          </div>
          <h1 className="auth-title">VoiceBank AI</h1>
          <p className="auth-subtitle">Secure Voice Banking Assistant</p>
        </div>

        {stage === 'auth' && (
          <div className="auth-form">
            <div className="input-group">
              <Phone className="input-icon" size={20} />
              <Input
                data-testid="phone-input"
                type="tel"
                placeholder="Enter your phone number"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className="auth-input"
              />
            </div>
            <Button data-testid="send-otp-btn" onClick={sendOTP} className="auth-button">
              Send OTP
            </Button>
            <p className="auth-note">🇮🇳 Supports English & Hindi | सुरक्षित बैंकिंग</p>
          </div>
        )}

        {stage === 'verify-otp' && (
          <div className="auth-form">
            <div className="input-group">
              <Lock className="input-icon" size={20} />
              <Input
                data-testid="otp-input"
                type="text"
                placeholder="Enter 6-digit OTP"
                value={otp}
                onChange={(e) => setOtp(e.target.value)}
                maxLength={6}
                className="auth-input"
              />
            </div>
            <Button data-testid="verify-otp-btn" onClick={verifyOTP} className="auth-button">
              Verify OTP
            </Button>
          </div>
        )}

        {stage === 'register' && (
          <div className="auth-form">
            <div className="input-group">
              <User className="input-icon" size={20} />
              <Input
                data-testid="name-input"
                type="text"
                placeholder="Enter your name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="auth-input"
              />
            </div>
            <div className="input-group">
              <Lock className="input-icon" size={20} />
              <Input
                data-testid="pin-input"
                type="password"
                placeholder="Create 4-digit PIN"
                value={pin}
                onChange={(e) => setPin(e.target.value)}
                maxLength={4}
                className="auth-input"
              />
            </div>
            <Button data-testid="register-btn" onClick={register} className="auth-button">
              Create Account
            </Button>
          </div>
        )}

        {stage === 'login' && (
          <div className="auth-form">
            <div className="input-group">
              <Lock className="input-icon" size={20} />
              <Input
                data-testid="login-pin-input"
                type="password"
                placeholder="Enter your PIN"
                value={pin}
                onChange={(e) => setPin(e.target.value)}
                maxLength={4}
                className="auth-input"
              />
            </div>
            <Button data-testid="login-btn" onClick={login} className="auth-button">
              Login
            </Button>
          </div>
        )}
      </div>
    </div>
  );

  const renderDashboard = () => (
    <div className="dashboard">
      <div className="dashboard-header">
        <div className="header-content">
          <h2 className="welcome-text">Welcome, {user?.name}</h2>
          <p className="phone-text">{user?.phone}</p>
        </div>
        <Button
          data-testid="logout-btn"
          variant="outline"
          onClick={() => {
            setStage('auth');
            setUser(null);
            setMessages([]);
          }}
          className="logout-btn"
        >
          Logout
        </Button>
      </div>

      <div className="dashboard-content">
        <div className="left-panel">
          <Card className="balance-card" data-testid="balance-card">
            <div className="balance-header">
              <IndianRupee className="rupee-icon" />
              <span className="balance-label">Available Balance</span>
            </div>
            <div className="balance-amount">₹{balance.toLocaleString('en-IN')}</div>
          </Card>

          <Card className="transactions-card" data-testid="transactions-card">
            <h3 className="card-title">Recent Transactions</h3>
            <div className="transactions-list">
              {transactions.length === 0 ? (
                <p className="no-transactions">No transactions yet</p>
              ) : (
                transactions.map((txn) => (
                  <div key={txn.id} className="transaction-item" data-testid={`transaction-${txn.id}`}>
                    <div className="transaction-icon">
                      {txn.type === 'transfer_out' ? (
                        <ArrowUpRight size={18} className="icon-out" />
                      ) : (
                        <ArrowDownLeft size={18} className="icon-in" />
                      )}
                    </div>
                    <div className="transaction-details">
                      <p className="transaction-desc">{txn.description}</p>
                      <p className="transaction-time">
                        {new Date(txn.timestamp).toLocaleDateString('en-IN')}
                      </p>
                    </div>
                    <div className="transaction-amount">
                      {txn.type === 'transfer_out' ? '-' : '+'}₹{txn.amount.toLocaleString('en-IN')}
                    </div>
                  </div>
                ))
              )}
            </div>
          </Card>
        </div>

        <div className="right-panel">
          <Card className="chat-card" data-testid="chat-card">
            <div className="chat-header">
              <div className="voice-indicator">
                <div className={`pulse-dot ${isListening ? 'active' : ''}`}></div>
                <span>VoiceBank AI Assistant</span>
              </div>
            </div>

            <div className="messages-container">
              {messages.length === 0 && (
                <div className="empty-state">
                  <Mic size={48} className="empty-icon" />
                  <p className="empty-text">Start speaking or type your query</p>
                  <p className="empty-hint">Ask me about balance, transactions, or transfers</p>
                </div>
              )}
              {messages.map((msg, idx) => (
                <div
                  key={idx}
                  className={`message ${msg.role}`}
                  data-testid={`message-${msg.role}-${idx}`}
                >
                  <div className="message-content">{msg.content}</div>
                </div>
              ))}
              <div ref={messagesEndRef} />
            </div>

            <div className="chat-input-container">
              {transcript && (
                <div className="transcript-preview" data-testid="transcript-preview">
                  Listening: {transcript}
                </div>
              )}
              <div className="input-controls">
                <Input
                  data-testid="chat-input"
                  type="text"
                  placeholder="Type or speak your message..."
                  value={inputMessage}
                  onChange={(e) => setInputMessage(e.target.value)}
                  onKeyPress={(e) => e.key === 'Enter' && sendMessage()}
                  className="chat-input"
                />
                <Button
                  data-testid="mic-btn"
                  onClick={toggleListening}
                  className={`mic-button ${isListening ? 'listening' : ''}`}
                  variant={isListening ? 'default' : 'outline'}
                >
                  {isListening ? <MicOff size={20} /> : <Mic size={20} />}
                </Button>
                <Button data-testid="send-btn" onClick={sendMessage} className="send-button">
                  <Send size={20} />
                </Button>
              </div>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );

  return (
    <div className="App">
      {stage === 'dashboard' ? renderDashboard() : renderAuth()}
    </div>
  );
}

export default App;