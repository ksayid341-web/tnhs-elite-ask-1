import React, { useState, useEffect, useRef, ErrorInfo } from 'react';
import { onAuthStateChanged, User } from 'firebase/auth';
import { collection, doc, onSnapshot, query, orderBy, addDoc, serverTimestamp, setDoc, updateDoc, getDoc } from 'firebase/firestore';
import { auth, db, signInWithGoogle, logOut } from './firebase';
import { GoogleGenAI } from '@google/genai';
import { Send, Menu, Plus, LogOut, MessageSquare, User as UserIcon, Bot, AlertTriangle } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from './lib/utils';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string;
    email?: string | null;
    emailVerified?: boolean;
    isAnonymous?: boolean;
    tenantId?: string | null;
    providerInfo?: {
      providerId: string;
      displayName: string | null;
      email: string | null;
      photoUrl: string | null;
    }[];
  }
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData.map(provider => ({
        providerId: provider.providerId,
        displayName: provider.displayName,
        email: provider.email,
        photoUrl: provider.photoURL
      })) || []
    },
    operationType,
    path
  }
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

class ErrorBoundary extends React.Component<{children: React.ReactNode}, {hasError: boolean, error: Error | null}> {
  constructor(props: {children: React.ReactNode}) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("Uncaught error:", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      let errorMessage = "An unexpected error occurred.";
      try {
        if (this.state.error?.message.startsWith('{')) {
          const parsed = JSON.parse(this.state.error.message);
          if (parsed.error && parsed.error.includes('Missing or insufficient permissions')) {
            errorMessage = "You don't have permission to perform this action. Please check your access rights.";
          } else if (parsed.error) {
            errorMessage = parsed.error;
          }
        } else if (this.state.error) {
          errorMessage = this.state.error.message;
        }
      } catch (e) {
        // Ignore parsing errors
      }

      return (
        <div className="min-h-screen flex items-center justify-center bg-[#f5f5f5] p-4">
          <div className="max-w-md w-full bg-white rounded-3xl shadow-sm p-8 text-center border border-red-100">
            <div className="w-16 h-16 bg-red-50 rounded-full mx-auto mb-6 flex items-center justify-center">
              <AlertTriangle className="w-8 h-8 text-red-500" />
            </div>
            <h2 className="text-2xl font-bold text-gray-900 mb-3">Something went wrong</h2>
            <p className="text-gray-600 mb-8">{errorMessage}</p>
            <button
              onClick={() => window.location.reload()}
              className="px-6 py-3 bg-black text-white rounded-full font-medium hover:bg-gray-800 transition-colors"
            >
              Reload Application
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

type Chat = {
  id: string;
  title: string;
  createdAt: any;
  updatedAt: any;
};

type Message = {
  id: string;
  role: 'user' | 'model';
  content: string;
  createdAt: any;
};

export default function App() {
  return (
    <ErrorBoundary>
      <MainApp />
    </ErrorBoundary>
  );
}

function MainApp() {
  const [user, setUser] = useState<User | null>(null);
  const [isAuthReady, setIsAuthReady] = useState(false);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      setUser(currentUser);
      if (currentUser) {
        try {
          // Ensure user document exists
          const userRef = doc(db, 'users', currentUser.uid);
          const userSnap = await getDoc(userRef);
          
          if (!userSnap.exists()) {
            await setDoc(userRef, {
              uid: currentUser.uid,
              email: currentUser.email || '',
              displayName: currentUser.displayName || '',
              photoURL: currentUser.photoURL || '',
              createdAt: serverTimestamp()
            });
          }
        } catch (error) {
          handleFirestoreError(error, OperationType.WRITE, `users/${currentUser.uid}`);
        }
      }
      setIsAuthReady(true);
    });
    return () => unsubscribe();
  }, []);

  if (!isAuthReady) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#f5f5f5]">
        <div className="animate-pulse flex flex-col items-center">
          <div className="w-12 h-12 border-4 border-gray-900 border-t-transparent rounded-full animate-spin"></div>
          <p className="mt-4 text-gray-500 font-medium">Loading ASK...</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return <SignInScreen />;
  }

  return <ChatInterface user={user} />;
}

function SignInScreen() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-[#f5f5f5] p-4 font-sans text-gray-900">
      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="max-w-md w-full bg-white rounded-3xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] p-10 text-center"
      >
        <div className="w-20 h-20 bg-black rounded-2xl mx-auto mb-8 flex items-center justify-center transform -rotate-6">
          <MessageSquare className="w-10 h-10 text-white" />
        </div>
        <h1 className="text-4xl font-bold tracking-tight mb-3">ASK</h1>
        <p className="text-gray-500 mb-10">Your intelligent conversation partner.</p>
        
        <button
          onClick={signInWithGoogle}
          className="w-full flex items-center justify-center gap-3 bg-black text-white rounded-full py-4 px-6 font-medium hover:bg-gray-800 transition-colors"
        >
          <svg className="w-5 h-5" viewBox="0 0 24 24">
            <path fill="currentColor" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
            <path fill="currentColor" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
            <path fill="currentColor" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
            <path fill="currentColor" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
          </svg>
          Continue with Google
        </button>
      </motion.div>
    </div>
  );
}

function ChatInterface({ user }: { user: User }) {
  const [chats, setChats] = useState<Chat[]>([]);
  const [activeChatId, setActiveChatId] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);

  useEffect(() => {
    const q = query(
      collection(db, 'users', user.uid, 'chats'),
      orderBy('updatedAt', 'desc')
    );
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const loadedChats = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as Chat[];
      setChats(loadedChats);
      if (loadedChats.length > 0 && !activeChatId) {
        setActiveChatId(loadedChats[0].id);
      }
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, `users/${user.uid}/chats`);
    });
    return () => unsubscribe();
  }, [user.uid]);

  const createNewChat = async () => {
    try {
      const newChatRef = await addDoc(collection(db, 'users', user.uid, 'chats'), {
        title: 'New Chat',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });
      setActiveChatId(newChatRef.id);
      if (window.innerWidth < 768) {
        setSidebarOpen(false);
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, `users/${user.uid}/chats`);
    }
  };

  return (
    <div className="flex h-screen bg-white font-sans overflow-hidden">
      {/* Sidebar */}
      <AnimatePresence initial={false}>
        {sidebarOpen && (
          <motion.div
            initial={{ width: 0, opacity: 0 }}
            animate={{ width: 280, opacity: 1 }}
            exit={{ width: 0, opacity: 0 }}
            className="h-full bg-[#f9f9f9] border-r border-gray-200 flex flex-col flex-shrink-0"
          >
            <div className="p-4 flex items-center justify-between">
              <span className="font-bold text-xl tracking-tight">ASK</span>
              <button 
                onClick={createNewChat}
                className="p-2 hover:bg-gray-200 rounded-full transition-colors"
                title="New Chat"
              >
                <Plus className="w-5 h-5" />
              </button>
            </div>
            
            <div className="flex-1 overflow-y-auto p-3 space-y-1">
              {chats.map(chat => (
                <button
                  key={chat.id}
                  onClick={() => {
                    setActiveChatId(chat.id);
                    if (window.innerWidth < 768) setSidebarOpen(false);
                  }}
                  className={cn(
                    "w-full text-left px-3 py-3 rounded-xl text-sm truncate transition-colors",
                    activeChatId === chat.id 
                      ? "bg-gray-200 font-medium" 
                      : "hover:bg-gray-100 text-gray-700"
                  )}
                >
                  {chat.title}
                </button>
              ))}
            </div>

            <div className="p-4 border-t border-gray-200 flex items-center justify-between">
              <div className="flex items-center gap-3 overflow-hidden">
                {user.photoURL ? (
                  <img src={user.photoURL} alt="Profile" className="w-8 h-8 rounded-full" referrerPolicy="no-referrer" />
                ) : (
                  <div className="w-8 h-8 bg-gray-300 rounded-full flex items-center justify-center">
                    <UserIcon className="w-4 h-4 text-gray-600" />
                  </div>
                )}
                <span className="text-sm font-medium truncate">{user.displayName || 'User'}</span>
              </div>
              <button onClick={logOut} className="p-2 text-gray-500 hover:text-black transition-colors">
                <LogOut className="w-4 h-4" />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Main Chat Area */}
      <div className="flex-1 flex flex-col min-w-0">
        <header className="h-14 border-b border-gray-100 flex items-center px-4">
          <button 
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="p-2 -ml-2 mr-2 text-gray-500 hover:text-black transition-colors"
          >
            <Menu className="w-5 h-5" />
          </button>
          <span className="font-medium text-gray-800 truncate">
            {chats.find(c => c.id === activeChatId)?.title || 'New Chat'}
          </span>
        </header>

        {activeChatId ? (
          <ChatThread user={user} chatId={activeChatId} />
        ) : (
          <div className="flex-1 flex items-center justify-center flex-col text-gray-400">
            <MessageSquare className="w-12 h-12 mb-4 opacity-20" />
            <p>Select a chat or start a new one</p>
            <button 
              onClick={createNewChat}
              className="mt-4 px-6 py-2 bg-black text-white rounded-full text-sm font-medium hover:bg-gray-800 transition-colors"
            >
              Start Chat
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function ChatThread({ user, chatId }: { user: User, chatId: string }) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [streamingContent, setStreamingContent] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const q = query(
      collection(db, 'users', user.uid, 'chats', chatId, 'messages'),
      orderBy('createdAt', 'asc')
    );
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const loadedMessages = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as Message[];
      setMessages(loadedMessages);
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, `users/${user.uid}/chats/${chatId}/messages`);
    });
    return () => unsubscribe();
  }, [user.uid, chatId]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streamingContent]);

  const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 200)}px`;
    }
  };

  const handleSend = async () => {
    if (!input.trim() || isGenerating) return;

    const userMessage = input.trim();
    setInput('');
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }

    try {
      // Save user message
      await addDoc(collection(db, 'users', user.uid, 'chats', chatId, 'messages'), {
        role: 'user',
        content: userMessage,
        createdAt: serverTimestamp()
      });

      // Update chat title if it's the first message
      if (messages.length === 0) {
        await updateDoc(doc(db, 'users', user.uid, 'chats', chatId), {
          title: userMessage.slice(0, 30) + (userMessage.length > 30 ? '...' : ''),
          updatedAt: serverTimestamp()
        });
      } else {
        await updateDoc(doc(db, 'users', user.uid, 'chats', chatId), {
          updatedAt: serverTimestamp()
        });
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, `users/${user.uid}/chats/${chatId}`);
      return;
    }

    setIsGenerating(true);
    setStreamingContent('');

    try {
      // Prepare history for Gemini
      const history = messages.map(m => ({
        role: m.role === 'user' ? 'user' : 'model',
        parts: [{ text: m.content }]
      }));

      const chat = ai.chats.create({
        model: 'gemini-3.1-flash-preview',
        history: history,
      });

      const responseStream = await chat.sendMessageStream({ message: userMessage });
      
      let fullResponse = '';
      for await (const chunk of responseStream) {
        if (chunk.text) {
          fullResponse += chunk.text;
          setStreamingContent(fullResponse);
        }
      }

      try {
        // Save model message
        await addDoc(collection(db, 'users', user.uid, 'chats', chatId, 'messages'), {
          role: 'model',
          content: fullResponse || "Sorry, I couldn't generate a response.",
          createdAt: serverTimestamp()
        });
      } catch (error) {
        handleFirestoreError(error, OperationType.CREATE, `users/${user.uid}/chats/${chatId}/messages`);
      }
      
    } catch (error) {
      console.error("Error generating response:", error);
      try {
        // Save error message
        await addDoc(collection(db, 'users', user.uid, 'chats', chatId, 'messages'), {
          role: 'model',
          content: "Sorry, I encountered an error while processing your request.",
          createdAt: serverTimestamp()
        });
      } catch (dbError) {
        handleFirestoreError(dbError, OperationType.CREATE, `users/${user.uid}/chats/${chatId}/messages`);
      }
    } finally {
      setIsGenerating(false);
      setStreamingContent('');
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="flex-1 flex flex-col relative">
      <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-6">
        {messages.length === 0 && (
          <div className="h-full flex flex-col items-center justify-center text-center max-w-md mx-auto">
            <div className="w-16 h-16 bg-gray-100 rounded-2xl flex items-center justify-center mb-6">
              <Bot className="w-8 h-8 text-gray-800" />
            </div>
            <h2 className="text-2xl font-semibold mb-2">How can I help you today?</h2>
            <p className="text-gray-500">Ask me anything, from writing code to answering complex questions.</p>
          </div>
        )}

        {messages.map((msg) => (
          <div 
            key={msg.id} 
            className={cn(
              "flex gap-4 max-w-3xl mx-auto",
              msg.role === 'user' ? "flex-row-reverse" : "flex-row"
            )}
          >
            <div className={cn(
              "w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0",
              msg.role === 'user' ? "bg-black" : "bg-gray-100"
            )}>
              {msg.role === 'user' ? (
                <UserIcon className="w-4 h-4 text-white" />
              ) : (
                <Bot className="w-5 h-5 text-gray-800" />
              )}
            </div>
            <div className={cn(
              "px-5 py-3.5 rounded-2xl max-w-[85%] text-[15px] leading-relaxed",
              msg.role === 'user' 
                ? "bg-gray-100 text-gray-900 rounded-tr-sm" 
                : "bg-white text-gray-800 border border-gray-100 shadow-sm rounded-tl-sm whitespace-pre-wrap"
            )}>
              {msg.content}
            </div>
          </div>
        ))}

        {streamingContent && (
          <div className="flex gap-4 max-w-3xl mx-auto flex-row">
            <div className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 bg-gray-100">
              <Bot className="w-5 h-5 text-gray-800" />
            </div>
            <div className="px-5 py-3.5 rounded-2xl max-w-[85%] text-[15px] leading-relaxed bg-white text-gray-800 border border-gray-100 shadow-sm rounded-tl-sm whitespace-pre-wrap">
              {streamingContent}
              <span className="inline-block w-1.5 h-4 ml-1 bg-gray-400 animate-pulse align-middle"></span>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} className="h-4" />
      </div>

      <div className="p-4 bg-white border-t border-gray-100">
        <div className="max-w-3xl mx-auto relative flex items-end gap-2 bg-gray-50 rounded-3xl p-2 border border-gray-200 focus-within:border-gray-300 focus-within:bg-white transition-colors shadow-sm">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={handleInput}
            onKeyDown={handleKeyDown}
            placeholder="Message ASK..."
            className="flex-1 max-h-[200px] min-h-[44px] bg-transparent resize-none py-3 px-4 outline-none text-[15px]"
            rows={1}
          />
          <button
            onClick={handleSend}
            disabled={!input.trim() || isGenerating}
            className="p-3 bg-black text-white rounded-full disabled:opacity-50 disabled:bg-gray-300 transition-colors flex-shrink-0 mb-0.5 mr-0.5"
          >
            <Send className="w-4 h-4" />
          </button>
        </div>
        <div className="text-center mt-3 text-xs text-gray-400">
          ASK can make mistakes. Consider verifying important information.
        </div>
      </div>
    </div>
  );
}

