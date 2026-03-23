"use client";

import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  type ReactNode,
} from "react";
import {
  loadSession,
  clearSession,
  type OkxSession,
  type WalletAddress,
} from "@/lib/okx-auth-store";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PersonaState {
  riskLevel: number;
  systemPrompt: string;
  allowSwap: boolean;
  allowBridge: boolean;
  allowDeposit: boolean;
}

export interface ConversationPreview {
  id: string;
  title: string;
  updatedAt: string;
}

interface AppState {
  // Auth state
  isAuthenticated: boolean;
  session: OkxSession | null;
  email: string | null;
  userAddress: string | null; // primary X Layer address
  addresses: WalletAddress[];
  accountId: string | null;
  login: (session: OkxSession) => void;
  logout: () => void;

  // Chat state
  chatActive: boolean;
  setChatActive: (active: boolean) => void;
  initialChatMessage: string | null;
  setInitialChatMessage: (msg: string | null) => void;
  activeConversationId: string | null;
  setActiveConversationId: (id: string | null) => void;
  conversations: ConversationPreview[];
  setConversations: (convos: ConversationPreview[]) => void;
  addConversation: (convo: ConversationPreview) => void;
  updateConversationTitle: (id: string, title: string) => void;

  // Persona
  persona: PersonaState;
  setPersona: (persona: Partial<PersonaState>) => void;
  setFullPersona: (persona: PersonaState) => void;

  // UI
  sidebarOpen: boolean;
  setSidebarOpen: (open: boolean) => void;
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

const AppContext = createContext<AppState | null>(null);

const DEFAULT_PERSONA: PersonaState = {
  riskLevel: 50,
  systemPrompt: "",
  allowSwap: true,
  allowBridge: false,
  allowDeposit: true,
};

const XLAYER_CHAIN_INDEX = "196";

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export function AppProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<OkxSession | null>(null);
  const [chatActive, setChatActive] = useState(false);
  const [initialChatMessage, setInitialChatMessage] = useState<string | null>(
    null,
  );
  const [activeConversationId, setActiveConversationId] = useState<
    string | null
  >(null);
  const [conversations, setConversations] = useState<ConversationPreview[]>([]);
  const [persona, setPersonaState] = useState<PersonaState>(DEFAULT_PERSONA);
  const [sidebarOpen, setSidebarOpen] = useState(true);

  // Load session from localStorage on mount
  useEffect(() => {
    const stored = loadSession();
    if (stored) {
      setSession(stored);
    }
  }, []);

  // Derived auth state
  const isAuthenticated = session !== null;
  const email = session?.email ?? null;
  const accountId = session?.accountId ?? null;
  const addresses = session?.addresses ?? [];

  // Primary X Layer address
  const userAddress =
    addresses.find((a) => a.chainIndex === XLAYER_CHAIN_INDEX)?.address ??
    addresses[0]?.address ??
    null;

  // Auth actions
  const login = useCallback((newSession: OkxSession) => {
    setSession(newSession);
  }, []);

  const logout = useCallback(() => {
    clearSession();
    setSession(null);
    setConversations([]);
    setChatActive(false);
    setInitialChatMessage(null);
    setActiveConversationId(null);
    setPersonaState(DEFAULT_PERSONA);
  }, []);

  // Persona
  const setPersona = useCallback((updates: Partial<PersonaState>) => {
    setPersonaState((prev) => ({ ...prev, ...updates }));
  }, []);

  const setFullPersona = useCallback((p: PersonaState) => {
    setPersonaState(p);
  }, []);

  // Conversations
  const addConversation = useCallback((convo: ConversationPreview) => {
    setConversations((prev) => [convo, ...prev]);
  }, []);

  const updateConversationTitle = useCallback((id: string, title: string) => {
    setConversations((prev) =>
      prev.map((c) => (c.id === id ? { ...c, title } : c)),
    );
  }, []);

  return (
    <AppContext.Provider
      value={{
        // Auth
        isAuthenticated,
        session,
        email,
        userAddress,
        addresses,
        accountId,
        login,
        logout,

        // Chat
        chatActive,
        setChatActive,
        initialChatMessage,
        setInitialChatMessage,
        activeConversationId,
        setActiveConversationId,
        conversations,
        setConversations,
        addConversation,
        updateConversationTitle,

        // Persona
        persona,
        setPersona,
        setFullPersona,

        // UI
        sidebarOpen,
        setSidebarOpen,
      }}
    >
      {children}
    </AppContext.Provider>
  );
}

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useApp must be used within AppProvider");
  return ctx;
}
