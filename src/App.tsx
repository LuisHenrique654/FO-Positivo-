import { useState, useMemo, useEffect, ChangeEvent } from 'react';
import { 
  Plus, 
  Minus, 
  UserPlus, 
  Search, 
  TrendingUp, 
  TrendingDown, 
  History, 
  Trash2, 
  ArrowUpDown,
  CheckCircle2,
  AlertCircle,
  LogIn,
  LogOut
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  collection, 
  onSnapshot, 
  addDoc, 
  updateDoc, 
  deleteDoc, 
  doc, 
  query, 
  orderBy, 
  setDoc,
  writeBatch,
  getDoc
} from 'firebase/firestore';
import { onAuthStateChanged, signInAnonymously, signOut } from 'firebase/auth';
import { db, auth, handleFirestoreError, OperationType, signInWithGoogle } from './lib/firebase';

// --- Types ---

interface Student {
  id: string;
  name: string;
  posScore: number;
  negScore: number;
  addedAt: number;
}

interface Toast {
  id: string;
  message: string;
  type: 'positive' | 'negative' | 'info';
  timestamp: number;
}

interface LogEntry {
  id: string;
  studentId: string;
  studentName: string;
  amount: number;
  type: 'positive' | 'negative';
  timestamp: number;
}

type TabType = 'positivo' | 'negativo' | 'todos';

// --- Main Component ---

export default function App() {
  const [students, setStudents] = useState<Student[]>([]);
  const [history, setHistory] = useState<LogEntry[]>([]);
  const [logoUrl, setLogoUrl] = useState<string>('');
  const [user, setUser] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<TabType>('todos');
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [editingStudentId, setEditingStudentId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  const [newStudentName, setNewStudentName] = useState('');
  const [isHistoryVisible, setIsHistoryVisible] = useState(false);
  const [sortBy, setSortBy] = useState<'score' | 'name'>('score');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [studentToDelete, setStudentToDelete] = useState<string | null>(null);

  // --- Effects ---

  // Auth & Sync
  useEffect(() => {
    const unsubscribeAuth = onAuthStateChanged(auth, (u) => {
      setUser(u);
      if (!u) {
        signInAnonymously(auth).catch(err => {
          console.error("Auth error:", err);
          if (err.code === 'auth/admin-restricted-operation') {
            console.warn("Anonymous Authentication is disabled in Firebase Console. Please enable it or use Google Sign-In.");
          }
          setIsLoading(false);
        });
      } else {
        setIsLoading(false);
      }
    });

    return () => unsubscribeAuth();
  }, []);

  useEffect(() => {
    if (!user) return;

    // Sync Students
    const qStudents = query(collection(db, 'students'), orderBy('addedAt', 'desc'));
    const unsubscribeStudents = onSnapshot(qStudents, (snapshot) => {
      const list: Student[] = [];
      snapshot.forEach(doc => list.push({ id: doc.id, ...doc.data() } as Student));
      setStudents(list);
      setIsLoading(false);
    }, (error) => handleFirestoreError(error, OperationType.LIST, 'students'));

    // Sync History
    const qHistory = query(collection(db, 'history'), orderBy('timestamp', 'desc'));
    const unsubscribeHistory = onSnapshot(qHistory, (snapshot) => {
      const list: LogEntry[] = [];
      snapshot.forEach(doc => list.push({ id: doc.id, ...doc.data() } as LogEntry));
      setHistory(list);
    }, (error) => handleFirestoreError(error, OperationType.LIST, 'history'));

    // Sync Global Config (Logo)
    const unsubscribeConfig = onSnapshot(doc(db, 'config', 'global'), (snapshot) => {
      if (snapshot.exists()) {
        setLogoUrl(snapshot.data().logoUrl || '');
      }
    }, (error) => handleFirestoreError(error, OperationType.GET, 'config/global'));

    return () => {
      unsubscribeStudents();
      unsubscribeHistory();
      unsubscribeConfig();
    };
  }, [user]);

  // --- Actions ---

  const addStudent = async () => {
    if (!newStudentName.trim() || !user) return;
    const studentData = {
      name: newStudentName.trim(),
      posScore: 0,
      negScore: 0,
      addedAt: Date.now(),
    };
    
    try {
      await addDoc(collection(db, 'students'), studentData);
      setNewStudentName('');
      showToast(`Aluno ${studentData.name} cadastrado no sistema.`, 'info');
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, 'students');
    }
  };

  const showToast = (message: string, type: 'positive' | 'negative' | 'info' = 'info') => {
    const id = crypto.randomUUID();
    setToasts(prev => [...prev, { id, message, type, timestamp: Date.now() }]);
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, 4000);
  };

  const startEditing = (student: Student) => {
    setEditingStudentId(student.id);
    setEditingName(student.name);
  };

  const cancelEditing = () => {
    setEditingStudentId(null);
    setEditingName('');
  };

  const saveName = async (id: string) => {
    if (!editingName.trim()) return;
    try {
      await updateDoc(doc(db, 'students', id), { name: editingName.trim() });
      showToast(`Identificação atualizada para ${editingName.trim()}`, 'info');
      cancelEditing();
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `students/${id}`);
    }
  };

  const updateScore = async (id: string, type: 'positive' | 'negative', amount: number = 1) => {
    const student = students.find(s => s.id === id);
    if (!student) return;

    try {
      const studentDoc = doc(db, 'students', id);
      const newPos = type === 'positive' ? Math.max(0, student.posScore + amount) : student.posScore;
      const newNeg = type === 'negative' ? Math.max(0, student.negScore + amount) : student.negScore;

      await updateDoc(studentDoc, {
        posScore: newPos,
        negScore: newNeg
      });

      showToast(
        `Registro de ${type === 'positive' ? 'MÉRITO' : 'FO'} para: ${student.name}`,
        type
      );

      await addDoc(collection(db, 'history'), {
        studentId: id,
        studentName: student.name,
        amount,
        type,
        timestamp: Date.now(),
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `students/${id}`);
    }
  };

  const deleteStudent = async (id: string) => {
    try {
      await deleteDoc(doc(db, 'students', id));
      setStudentToDelete(null);
      showToast('Aluno removido do sistema.', 'info');
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `students/${id}`);
    }
  };

  const clearAllStudents = async () => {
    try {
      const batch = writeBatch(db);
      
      // Delete all students
      students.forEach(s => {
        batch.delete(doc(db, 'students', s.id));
      });

      // Delete all history
      history.forEach(h => {
        batch.delete(doc(db, 'history', h.id));
      });

      await batch.commit();
      setShowClearConfirm(false);
      showToast('Todos os alunos foram removidos do sistema.', 'negative');
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, 'bulk-delete');
    }
  };

  const handleLogout = () => signOut(auth).catch(err => handleFirestoreError(err, OperationType.WRITE, 'auth/logout'));
  
  const handleLogoUpload = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = async () => {
        const base64 = reader.result as string;
        try {
          await setDoc(doc(db, 'config', 'global'), { logoUrl: base64 }, { merge: true });
          showToast('Logo atualizada para todos os usuários.', 'info');
        } catch (error) {
          handleFirestoreError(error, OperationType.WRITE, 'config/global');
        }
      };
      reader.readAsDataURL(file);
    }
  };

  // --- Derived State ---

  const filteredStudents = useMemo(() => {
    let result = [...students];

    // Search
    if (searchQuery) {
      result = result.filter(s => 
        s.name.toLowerCase().includes(searchQuery.toLowerCase())
      );
    }

    // Tab filtering - Allow student in both if they have points in both
    if (activeTab === 'positivo') {
      result = result.filter(s => s.posScore > 0);
    } else if (activeTab === 'negativo') {
      result = result.filter(s => s.negScore > 0);
    }

    // Sorting
    result.sort((a, b) => {
      const multiplier = sortOrder === 'asc' ? 1 : -1;
      if (sortBy === 'score') {
        const scoreA = a.posScore - a.negScore;
        const scoreB = b.posScore - b.negScore;
        return (scoreA - scoreB) * multiplier;
      }
      return a.name.localeCompare(b.name) * multiplier;
    });

    return result;
  }, [students, searchQuery, activeTab, sortBy, sortOrder]);

  const stats = useMemo(() => ({
    total: students.length,
    positive: students.filter(s => s.posScore > 0).length,
    negative: students.filter(s => s.negScore > 0).length,
    neutral: students.filter(s => s.posScore === 0 && s.negScore === 0).length,
  }), [students]);

  // --- Rendering ---

  return (
    <div className="min-h-screen bg-moss-950 text-moss-50 font-sans bg-camouflage bg-fixed">
      {/* Loading Overlay */}
      <AnimatePresence>
        {isLoading && (
          <motion.div 
            initial={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] bg-moss-950 flex flex-col items-center justify-center gap-4"
          >
            <div className="w-16 h-16 border-4 border-orange-500/20 border-t-orange-500 rounded-full animate-spin"></div>
            <div className="text-orange-500 font-black uppercase tracking-widest text-xs animate-pulse">
              Autenticando Unidade Ativa...
            </div>
            {!user && !isLoading && (
              <motion.button
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                onClick={signInWithGoogle}
                className="mt-4 px-6 py-3 bg-orange-500 text-white rounded-lg font-black uppercase tracking-widest text-xs flex items-center gap-2 hover:bg-orange-600 transition-colors shadow-lg active:scale-95"
              >
                <LogIn className="w-4 h-4" /> Entrar com Google
              </motion.button>
            )}
          </motion.div>
        )}
      </AnimatePresence>
      {/* Header */}
      <header className="bg-moss-900/80 backdrop-blur-md border-b border-moss-800 sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-14 sm:h-16 flex items-center justify-between">
          {/* Toasts / Notifications Overlay */}
          <div className="fixed top-16 right-4 left-4 sm:left-auto z-50 flex flex-col gap-2 pointer-events-none">
            <AnimatePresence>
              {toasts.map((toast) => (
                <motion.div
                  key={toast.id}
                  initial={{ opacity: 0, y: -20, scale: 0.9 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, x: 20, scale: 0.95 }}
                  className={`
                    px-4 py-3 rounded-lg shadow-2xl border-l-4 font-black text-[10px] uppercase tracking-widest flex items-center gap-3 backdrop-blur-xl sm:min-w-[280px]
                    ${toast.type === 'positive' ? 'bg-emerald-950/90 border-emerald-500 text-emerald-400' : 
                      toast.type === 'negative' ? 'bg-rose-950/90 border-rose-500 text-rose-400' : 
                      'bg-moss-900/90 border-moss-500 text-moss-300'}
                  `}
                >
                  <div className={`p-1 rounded bg-black/20 text-white shrink-0`}>
                    {toast.type === 'positive' ? <CheckCircle2 className="w-4 h-4" /> : 
                     toast.type === 'negative' ? <AlertCircle className="w-4 h-4" /> : 
                     <TrendingUp className="w-4 h-4" />}
                  </div>
                  {toast.message}
                </motion.div>
              ))}
            </AnimatePresence>
          </div>

          <div className="flex items-center gap-2 sm:gap-3">
            <div className="w-8 h-8 sm:w-10 sm:h-10 bg-moss-800 rounded-lg border border-moss-700 flex items-center justify-center overflow-hidden shrink-0">
               <img 
                src={logoUrl || "/logo.png"} 
                alt="Logo" 
                className="w-full h-full object-cover"
                onError={(e) => {
                  if (!logoUrl) (e.target as HTMLImageElement).src = 'https://picsum.photos/seed/cascavel/200/200';
                }}
              />
            </div>
            <h1 className="text-lg sm:text-xl font-black tracking-tighter hidden xs:block uppercase italic text-orange-500">Cascavel fire</h1>
          </div>

          <div className="flex-1 max-w-[150px] sm:max-w-md mx-2 sm:mx-4">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 text-moss-400 w-3.5 h-3.5" />
              <input 
                type="text" 
                placeholder="Aluno..."
                className="w-full pl-8 sm:pl-10 pr-4 py-1.5 sm:py-2 bg-moss-800/50 border border-moss-700 rounded-lg text-xs sm:text-sm focus:ring-2 focus:ring-moss-500 transition-all outline-none text-moss-50 placeholder:text-moss-500"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button 
              onClick={() => setIsHistoryVisible(!isHistoryVisible)}
              className="p-2 hover:bg-moss-800 rounded-full transition-colors relative"
              title="Log de Operações"
            >
              <History className="w-5 h-5 text-moss-300" />
              {history.length > 0 && (
                <span className="absolute top-0 right-0 w-2 h-2 bg-moss-500 rounded-full border-2 border-moss-900"></span>
              )}
            </button>
            
            {user ? (
              <button 
                onClick={handleLogout}
                className="p-2 hover:bg-moss-800 rounded-full transition-colors text-moss-500 hover:text-rose-500"
                title="Sair"
              >
                <LogOut className="w-5 h-5" />
              </button>
            ) : (
              <button 
                onClick={signInWithGoogle}
                className="p-2 hover:bg-moss-800 rounded-full transition-colors text-orange-500"
                title="Entrar"
              >
                <LogIn className="w-5 h-5" />
              </button>
            )}
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 sm:py-8">
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6 sm:gap-8">
          
          {/* Sidebar / Stats */}
          <div className="lg:col-span-1 space-y-4 sm:space-y-6">
            {/* Branding Card - Compact on Mobile */}
            <div className="bg-moss-900/50 p-4 sm:p-6 rounded-2xl border border-moss-800 shadow-xl flex sm:flex-col items-center justify-center gap-3 sm:gap-4 text-center group/logo relative overflow-hidden">
              <div className="w-16 h-16 sm:w-24 sm:h-24 bg-moss-800 rounded-2xl sm:rounded-3xl border-2 border-moss-700 p-1 shadow-inner flex items-center justify-center overflow-hidden group-hover:border-moss-500 transition-colors shrink-0">
                <img 
                  src={logoUrl || "/logo.png"} 
                  alt="Cascavel Fire Logo" 
                  className="w-full h-full object-cover"
                  onError={(e) => {
                    if (!logoUrl) (e.target as HTMLImageElement).src = 'https://picsum.photos/seed/cascavel/400/400';
                  }}
                />
              </div>
              
              <label className="absolute inset-0 bg-moss-950/80 opacity-0 group-hover/logo:opacity-100 transition-opacity flex flex-col items-center justify-center cursor-pointer p-4 backdrop-blur-sm">
                <Plus className="w-6 h-6 text-orange-500 mb-2" />
                <span className="text-[10px] font-black uppercase text-white tracking-widest">Alterar Logo</span>
                <input 
                  type="file" 
                  accept="image/*" 
                  className="hidden" 
                  onChange={handleLogoUpload}
                />
              </label>

              <div className="text-left sm:text-center">
                <h2 className="text-lg sm:text-xl font-black uppercase text-orange-500 italic tracking-tighter">Cascavel Fire</h2>
                <p className="text-[9px] sm:text-[10px] text-moss-500 font-bold uppercase tracking-widest mt-1">Tactical Training Unit</p>
              </div>
            </div>

            {/* Quick Stats - Grid on mobile */}
            <div className="bg-moss-900 p-4 sm:p-6 rounded-2xl border border-moss-800 shadow-xl space-y-3 sm:space-y-4">
              <h2 className="text-[10px] sm:text-xs font-bold text-moss-500 uppercase tracking-[0.2em] hidden sm:block">Status do Curso</h2>
              <div className="grid grid-cols-2 lg:grid-cols-2 gap-3 sm:gap-4">
                <div className="bg-emerald-950/50 p-2 sm:p-3 rounded-xl border border-emerald-900/50 transition-all hover:shadow-md flex sm:flex-col items-center sm:items-start justify-between sm:justify-center">
                  <div className="text-emerald-400 font-bold text-xl sm:text-2xl">{stats.positive}</div>
                  <div className="text-emerald-500 text-[9px] sm:text-[10px] font-black uppercase tracking-wider">MÉRITOS</div>
                </div>
                <div className="bg-rose-950/50 p-2 sm:p-3 rounded-xl border border-rose-900/50 transition-all hover:shadow-md flex sm:flex-col items-center sm:items-start justify-between sm:justify-center">
                  <div className="text-rose-400 font-bold text-xl sm:text-2xl">{stats.negative}</div>
                  <div className="text-rose-500 text-[9px] sm:text-[10px] font-black uppercase tracking-wider">FO</div>
                </div>
              </div>
              <div className="text-[9px] sm:text-[10px] text-moss-500 text-center font-mono uppercase tracking-widest pt-2 border-t border-moss-800/50">
                Total: {stats.total} | Neutros: {stats.neutral}
              </div>
            </div>

            {/* Add Student Form - Collapsible or very compact on mobile */}
            <div className="bg-camouflage p-4 sm:p-6 rounded-2xl sm:rounded-3xl shadow-2xl border border-moss-700 text-white relative overflow-hidden group">
              <div className="absolute inset-0 bg-moss-950/20 group-hover:bg-moss-950/10 transition-colors pointer-events-none"></div>
              <div className="relative z-10">
                <h3 className="font-black text-[10px] sm:text-sm uppercase tracking-widest mb-3 sm:mb-4 flex items-center gap-2 italic">
                  <UserPlus className="w-4 h-4 sm:w-5 sm:h-5 text-moss-300" /> Cadastrar Aluno
                </h3>
                <div className="flex flex-col gap-2">
                  <div className="flex gap-2">
                    <input 
                      type="text" 
                      placeholder="NOME..."
                      className="flex-1 px-3 py-2 rounded-lg bg-moss-950/60 border border-moss-600 placeholder-moss-600 focus:outline-none focus:ring-2 focus:ring-moss-400 transition-all text-moss-50 font-bold uppercase text-xs sm:text-sm"
                      value={newStudentName}
                      onChange={(e) => setNewStudentName(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && addStudent()}
                    />
                    <button 
                      onClick={addStudent}
                      className="bg-moss-300 text-moss-950 font-black px-4 py-2 rounded-lg hover:bg-moss-200 transition-all shadow-lg active:scale-95 duration-200 flex items-center justify-center gap-2 uppercase text-[10px] tracking-tighter"
                    >
                      <Plus className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Main Content Areas */}
          <div className="lg:col-span-3 space-y-4 sm:space-y-6">
            {/* Tabs */}
            <div className="flex bg-moss-900 border border-moss-800 p-1 rounded-xl w-full overflow-x-auto scrollbar-hide">
              {(['todos', 'positivo', 'negativo'] as TabType[]).map((tab) => (
                <button
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  className={`
                    flex-1 px-3 sm:px-6 py-2 rounded-lg text-[10px] sm:text-xs font-black uppercase tracking-widest transition-all duration-300 whitespace-nowrap
                    ${activeTab === tab 
                      ? 'bg-moss-700 text-moss-50 shadow-[0_0_15px_rgba(171,184,132,0.2)]' 
                      : 'text-moss-500 hover:text-moss-300'}
                  `}
                >
                  {tab === 'todos' ? 'Geral' : `FO ${tab}`}
                </button>
              ))}
            </div>

            {/* Controls */}
            <div className="border-b border-moss-800 pb-4 space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-xs sm:text-sm font-black text-moss-500 uppercase tracking-[0.3em] flex items-center gap-2 italic">
                  Relação Nominal
                  <span className="text-[10px] bg-moss-900 text-moss-300 px-2 py-0.5 rounded border border-moss-800 font-mono">
                    {filteredStudents.length}
                  </span>
                </h2>

                {/* Mobile Reset Action */}
                <div className="sm:hidden">
                  {showClearConfirm ? (
                    <div className="flex items-center gap-2 bg-rose-950/60 px-3 py-2 rounded-lg border border-rose-500/50 animate-in fade-in slide-in-from-right-2 duration-200">
                      <button 
                        onClick={clearAllStudents}
                        className="text-rose-400 font-black uppercase text-[11px] flex items-center gap-1"
                      >
                        <Trash2 className="w-3 h-3" /> CONFIRMAR ZERAR?
                      </button>
                      <button 
                        onClick={() => setShowClearConfirm(false)}
                        className="text-moss-400 font-black uppercase text-[11px] ml-2 border-l border-moss-700 pl-2"
                      >
                        CANCELAR
                      </button>
                    </div>
                  ) : (
                    <button 
                      onClick={() => setShowClearConfirm(true)}
                      className="flex items-center gap-1.5 bg-rose-950/30 px-3 py-1.5 rounded-lg border border-rose-900/40 text-rose-500 font-bold uppercase text-[10px] tracking-tight active:scale-95 transition-all shadow-lg"
                    >
                      <Trash2 className="w-3.5 h-3.5" /> Limpar Lista
                    </button>
                  )}
                </div>
              </div>

              <div className="flex items-center justify-between bg-moss-950/30 p-2 rounded-lg border border-moss-800/50">
                <div className="flex items-center gap-4 text-[9px] sm:text-[10px] text-moss-500 font-black uppercase tracking-wider">
                  <button 
                    onClick={() => {
                      if (sortBy === 'score') setSortOrder(prev => prev === 'asc' ? 'desc' : 'asc');
                      else { setSortBy('score'); setSortOrder('desc'); }
                    }}
                    className={`flex items-center gap-1 transition-colors ${sortBy === 'score' ? 'text-moss-300' : ''}`}
                  >
                    <ArrowUpDown className="w-3 h-3" /> Mérito
                  </button>
                  <button 
                    onClick={() => {
                      if (sortBy === 'name') setSortOrder(prev => prev === 'asc' ? 'desc' : 'asc');
                      else { setSortBy('name'); setSortOrder('asc'); }
                    }}
                    className={`flex items-center gap-1 transition-colors ${sortBy === 'name' ? 'text-moss-300' : ''}`}
                  >
                    <ArrowUpDown className="w-3 h-3" /> Alfabeto
                  </button>
                </div>

                {/* Desktop Reset Action */}
                <div className="hidden sm:block">
                  {showClearConfirm ? (
                    <div className="flex items-center gap-2 bg-rose-950/30 px-2 py-1.5 rounded border border-rose-900/50">
                      <span className="text-[9px] font-bold uppercase text-rose-200 whitespace-nowrap">Apagar tudo?</span>
                      <div className="flex gap-2">
                        <button 
                          onClick={clearAllStudents}
                          className="text-emerald-500 hover:text-emerald-400 font-black uppercase text-[10px]"
                        >
                          SIM
                        </button>
                        <button 
                          onClick={() => setShowClearConfirm(false)}
                          className="text-moss-400 hover:text-moss-200 font-black uppercase text-[10px]"
                        >
                          NÃO
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button 
                      onClick={() => setShowClearConfirm(true)}
                      className="flex items-center gap-1 text-rose-800 hover:text-rose-600 transition-colors font-black uppercase text-[10px]"
                    >
                      <Trash2 className="w-3 h-3" /> Zerar Tudo
                    </button>
                  )}
                </div>
              </div>
            </div>

            {/* Student List */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <AnimatePresence mode="popLayout">
                {filteredStudents.length > 0 ? (
                  filteredStudents.map((student) => (
                    <motion.div
                      layout
                      initial={{ opacity: 0, x: -20 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, scale: 0.95 }}
                      key={student.id}
                      className={`
                        p-5 rounded-2xl border transition-all duration-300 bg-moss-900/50
                        ${(student.posScore > 0 && student.negScore > 0) ? 'border-amber-900/40 hover:border-amber-600/60' :
                          student.posScore > 0 ? 'border-emerald-900/40 hover:border-emerald-600/60' : 
                          student.negScore > 0 ? 'border-rose-900/40 hover:border-rose-600/60' : 
                          'border-moss-800 hover:border-moss-600'}
                        group shadow-lg hover:shadow-moss-950 relative overflow-hidden backdrop-blur-sm
                      `}
                    >
                      {/* Interaction Overlay */}
                      <div className="absolute right-2 top-2 flex items-center gap-1 transition-all z-20">
                        {studentToDelete === student.id ? (
                          <div className="flex items-center gap-2 bg-rose-950/80 px-2 py-1 rounded border border-rose-900 backdrop-blur-sm animate-in fade-in zoom-in duration-200">
                            <span className="text-[8px] font-black uppercase text-rose-200">Excluir?</span>
                            <button 
                              onClick={() => deleteStudent(student.id)}
                              className="text-emerald-500 hover:text-emerald-400 font-black uppercase text-[10px]"
                            >
                              Sim
                            </button>
                            <button 
                              onClick={() => setStudentToDelete(null)}
                              className="text-moss-400 hover:text-moss-200 font-black uppercase text-[10px]"
                            >
                              Não
                            </button>
                          </div>
                        ) : (
                          <>
                            <button 
                              onClick={() => startEditing(student)}
                              className="p-2 text-moss-500 sm:text-moss-700 hover:text-moss-300 transition-colors"
                              title="Editar Nome"
                            >
                              <TrendingUp className="w-3.5 h-3.5 sm:w-3 sm:h-3 rotate-12" />
                            </button>
                            <button 
                              onClick={() => setStudentToDelete(student.id)}
                              className="p-2 text-moss-500 sm:text-moss-700 hover:text-rose-500 transition-colors"
                              title="Remover"
                            >
                              <Trash2 className="w-3.5 h-3.5 sm:w-3 sm:h-3" />
                            </button>
                          </>
                        )}
                      </div>

                      <div className="flex items-center justify-between gap-2 sm:gap-4">
                        <div className="min-w-0 flex-1">
                          {editingStudentId === student.id ? (
                            <div className="flex flex-col gap-2">
                              <input 
                                autoFocus
                                type="text"
                                className="w-full bg-moss-950 border border-moss-600 rounded px-2 py-1.5 text-xs font-black text-moss-50 uppercase focus:ring-1 focus:ring-moss-400 outline-none"
                                value={editingName}
                                onChange={(e) => setEditingName(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') saveName(student.id);
                                  if (e.key === 'Escape') cancelEditing();
                                }}
                              />
                              <div className="flex gap-4">
                                <button onClick={() => saveName(student.id)} className="text-[10px] p-1 font-black uppercase text-emerald-500 hover:text-emerald-400 bg-emerald-950/30 rounded border border-emerald-900 w-full">Salvar</button>
                                <button onClick={cancelEditing} className="text-[10px] p-1 font-black uppercase text-moss-500 hover:text-moss-400 bg-moss-800/30 rounded border border-moss-700 w-full">Sair</button>
                              </div>
                            </div>
                          ) : (
                            <h3 className="font-black text-moss-50 truncate uppercase tracking-tighter text-base sm:text-lg italic group-hover:text-orange-500 transition-colors leading-tight">{student.name}</h3>
                          )}
                          <div className="flex flex-wrap items-center gap-2 sm:gap-3 mt-2">
                             <div className="flex items-center gap-1.5">
                               <span className={`text-xl sm:text-2xl font-black font-mono ${student.posScore > 0 ? 'text-emerald-400' : 'text-moss-600'}`}>
                                  +{student.posScore}
                               </span>
                               {student.posScore > 0 && <CheckCircle2 className="w-4 h-4 text-emerald-500/50" />}
                             </div>
                             <div className="w-px h-3 bg-moss-800"></div>
                             <div className="flex items-center gap-1.5">
                               <span className={`text-xl sm:text-2xl font-black font-mono ${student.negScore > 0 ? 'text-rose-400' : 'text-moss-600'}`}>
                                  -{student.negScore}
                               </span>
                               {student.negScore > 0 && <AlertCircle className="w-4 h-4 text-rose-500/50" />}
                             </div>
                          </div>
                        </div>

                        <div className="flex flex-col gap-2 shrink-0">
                          {/* Positive Controls */}
                          <div className="flex items-center gap-1">
                            <button 
                              onClick={() => updateScore(student.id, 'positive', -1)}
                              className="w-8 h-10 flex items-center justify-center rounded-lg bg-moss-900 text-emerald-700 border border-emerald-950/50 hover:bg-moss-800 transition-all active:scale-95"
                              title="Remover Positivo"
                            >
                              <Minus className="w-4 h-4" />
                            </button>
                            <button 
                              onClick={() => updateScore(student.id, 'positive', 1)}
                              className="w-12 h-10 flex items-center justify-center rounded-lg bg-emerald-700 text-moss-50 border border-emerald-600 shadow-[0_4px_0_var(--color-moss-800)] active:translate-y-[2px] active:shadow-[0_2px_0_var(--color-moss-800)] hover:bg-emerald-600 transition-all font-black"
                              title="Adicionar Positivo"
                            >
                              <Plus className="w-6 h-6" />
                            </button>
                          </div>

                          {/* Negative Controls */}
                          <div className="flex items-center gap-1">
                            <button 
                              onClick={() => updateScore(student.id, 'negative', -1)}
                              className="w-8 h-10 flex items-center justify-center rounded-lg bg-moss-900 text-rose-700 border border-rose-950/50 hover:bg-moss-800 transition-all active:scale-95"
                              title="Remover Negativo"
                            >
                              <Plus className="w-4 h-4 rotate-45" />
                            </button>
                            <button 
                              onClick={() => updateScore(student.id, 'negative', 1)}
                              className="w-12 h-10 flex items-center justify-center rounded-lg bg-rose-900 text-white border border-rose-800 shadow-[0_4px_0_#1a1c0d] active:translate-y-[2px] active:shadow-[0_2px_0_#1a1c0d] hover:bg-rose-800 transition-all font-black"
                              title="Adicionar Negativo"
                            >
                              <Minus className="w-6 h-6 border-transparent" />
                            </button>
                          </div>
                        </div>
                      </div>
                    </motion.div>
                  ))
                ) : (
                  <div className="col-span-full py-20 flex flex-col items-center justify-center text-moss-600 bg-moss-900/30 rounded-3xl border-2 border-dashed border-moss-800">
                    <Search className="w-12 h-12 mb-4 opacity-20" />
                    <p className="font-black uppercase tracking-widest text-xs">Sem Dados</p>
                    <p className="text-[10px] mt-2 opacity-60">Nenhum aluno encontrado para este filtro.</p>
                  </div>
                )}
              </AnimatePresence>
            </div>
          </div>
        </div>
      </main>

      {/* History Slide-over/Panel (Overlay) */}
      <AnimatePresence>
        {isHistoryVisible && (
          <>
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsHistoryVisible(false)}
              className="fixed inset-0 bg-moss-950/80 backdrop-blur-md z-40" 
            />
            <motion.div 
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              transition={{ type: 'spring', damping: 25, stiffness: 200 }}
              className="fixed top-0 right-0 bottom-0 w-full max-w-sm bg-moss-900 shadow-2xl z-50 overflow-y-auto border-l border-moss-800"
            >
              <div className="p-6 border-b border-moss-800 flex items-center justify-between sticky top-0 bg-moss-900 z-10">
                <h3 className="text-sm font-black text-moss-100 uppercase tracking-widest flex items-center gap-2 italic">
                  <History className="w-5 h-5 text-moss-400" /> Log de Transmissão
                </h3>
                <button 
                  onClick={() => setIsHistoryVisible(false)}
                  className="p-2 hover:bg-moss-800 rounded-lg transition-colors text-moss-500 uppercase text-[10px] font-black"
                >
                  X
                </button>
              </div>
              <div className="p-6 space-y-6">
                {history.length > 0 ? (
                  history.map((log) => (
                    <div key={log.id} className="flex gap-4 group">
                      <div className={`
                        flex-shrink-0 w-10 h-10 rounded-lg border-2 flex items-center justify-center text-xs font-black
                        ${log.type === 'positive' ? 'border-emerald-900 bg-emerald-950 text-emerald-400' : 'border-rose-900 bg-rose-950 text-rose-400'}
                      `}>
                        {log.amount > 0 ? `+${log.amount}` : log.amount}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-black text-moss-100 uppercase tracking-tighter truncate">
                          {log.studentName}
                        </p>
                        <p className="text-[10px] text-moss-500 uppercase font-bold mt-0.5">
                          {log.type === 'positive' ? 'Mérito Acadêmico' : 'Ficha de Ocorrência'}
                        </p>
                        <p className="text-[9px] text-moss-600 mt-2 font-mono tracking-tighter">
                          T:{new Date(log.timestamp).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                        </p>
                      </div>
                    </div>
                  ))
                ) : (
                   <div className="py-20 text-center text-moss-700">
                    <History className="w-10 h-10 mx-auto mb-2 opacity-10" />
                    <p className="text-[10px] font-black uppercase tracking-widest">Sem Registros</p>
                  </div>
                )}
              </div>
              <div className="p-6 bg-moss-950/50 border-t border-moss-800">
                <button 
                  onClick={() => setHistory([])}
                  className="w-full py-3 text-[10px] font-black text-rose-800 hover:text-rose-600 transition-colors uppercase tracking-[0.2em]"
                >
                  Limpar Transmissões
                </button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Footer */}
      <footer className="max-w-7xl mx-auto px-4 py-12 text-center text-moss-700 text-[9px] font-black uppercase tracking-[0.3em] border-t border-moss-900 mt-12 bg-camouflage/20 rounded-t-[50px]">
        <p>&copy; 2026 Cascavel Fire - Tactical Education Support</p>
        <p className="mt-2 text-moss-800">CFI Command / Protocolo de Alunos Ativo</p>
      </footer>
    </div>
  );
}
