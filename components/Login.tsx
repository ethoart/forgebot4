import React, { useState } from 'react';
import { Lock, ArrowRight, Loader2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { login } from '../services/api';

const Login: React.FC = () => {
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const navigate = useNavigate();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(false);
    
    const success = await login(password);
    if (success) {
        localStorage.setItem('isAuthenticated', 'true');
        navigate('/admin');
    } else {
        setError(true);
        setPassword('');
    }
    setLoading(false);
  };

  return (
    <div className="min-h-screen bg-slate-900 flex items-center justify-center p-6">
       <div className="w-full max-w-sm bg-white rounded-3xl p-8 shadow-2xl animate-in fade-in zoom-in-95 duration-300">
           <div className="flex justify-center mb-6">
               <div className="p-4 bg-blue-50 rounded-2xl">
                   <Lock className="w-8 h-8 text-blue-600" />
               </div>
           </div>
           
           <h2 className="text-2xl font-bold text-center text-slate-800 mb-2">Admin Access</h2>
           <p className="text-center text-slate-500 mb-8 text-sm">Enter secure password to continue</p>
           
           <form onSubmit={handleLogin} className="space-y-4">
               <div>
                   <input 
                      type="password" 
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="Password"
                      className={`w-full px-4 py-3 rounded-xl border ${error ? 'border-red-300 bg-red-50 focus:ring-red-200' : 'border-slate-200 bg-slate-50 focus:ring-blue-200'} focus:outline-none focus:ring-2 transition-all`}
                      autoFocus
                   />
               </div>
               
               <button 
                 disabled={loading}
                 className="w-full py-3 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-xl flex items-center justify-center transition-all active:scale-95 disabled:opacity-70"
               >
                   {loading ? <Loader2 className="animate-spin w-5 h-5" /> : <>Login <ArrowRight className="ml-2 w-4 h-4" /></>}
               </button>
           </form>
       </div>
    </div>
  );
};

export default Login;