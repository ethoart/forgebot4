import React, { useState, useEffect } from 'react';
import { User, Video, Check, Loader2, ChevronLeft, Calendar } from 'lucide-react';
import { registerCustomer, getEvents } from '../services/api';
import { Link } from 'react-router-dom';
import { Event } from '../types';

const MobileRegister: React.FC = () => {
  const [formData, setFormData] = useState({ name: '', phone: '', videoName: '', fileType: 'video' as 'video'|'photo', eventId: '' });
  const [countryCode, setCountryCode] = useState('+94');
  const [status, setStatus] = useState<'idle' | 'submitting' | 'success'>('idle');
  const [events, setEvents] = useState<Event[]>([]);
  const [loadingEvents, setLoadingEvents] = useState(true);

  useEffect(() => {
      const loadEvents = async () => {
          const data = await getEvents();
          setEvents(data);
          // Default to first active event if exists
          const active = data.find(e => e.isActive);
          if (active) {
              setFormData(prev => ({ ...prev, eventId: active.id, fileType: active.defaultFileType || 'video' }));
          } else if (data.length > 0) {
              setFormData(prev => ({ ...prev, eventId: data[0].id, fileType: data[0].defaultFileType || 'video' }));
          }
          setLoadingEvents(false);
      };
      loadEvents();
  }, []);

  // Watch for event changes to update default file type
  useEffect(() => {
    if (formData.eventId) {
        const selectedEvent = events.find(e => e.id === formData.eventId);
        if (selectedEvent) {
             setFormData(prev => ({ ...prev, fileType: selectedEvent.defaultFileType || 'video' }));
        }
    }
  }, [formData.eventId, events]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name || !formData.phone || !formData.videoName) return;
    
    // Safety check for event
    if (events.length > 0 && !formData.eventId) {
        alert("Please select an event");
        return;
    }

    setStatus('submitting');
    
    // Clean input and remove non-numeric chars
    let cleanPhone = formData.phone.replace(/[^0-9]/g, '');
    
    // Remove leading zero if user typed it (e.g. 077... -> 77...)
    if (cleanPhone.startsWith('0')) {
        cleanPhone = cleanPhone.substring(1);
    }
    
    // Combine selected country code (removing non-digits) with cleaned phone
    const prefix = countryCode.replace(/[^0-9]/g, '');
    const finalPhone = prefix + cleanPhone;

    // Logic to append extension automatically
    let finalFileName = formData.videoName;
    const ext = formData.fileType === 'photo' ? '.jpg' : '.mp4';
    
    // Check if filename already ends with the correct extension
    if (!finalFileName.toLowerCase().endsWith(ext)) {
        finalFileName = finalFileName + ext;
    }

    const success = await registerCustomer(
        formData.name, 
        finalPhone, 
        finalFileName, 
        formData.fileType,
        formData.eventId
    );
    
    if (success) {
      setStatus('success');
      setTimeout(() => {
        // Keep event, country code and filetype, reset others
        setFormData(prev => ({ ...prev, name: '', phone: '', videoName: '' })); 
        setStatus('idle');
      }, 3000);
    } else {
      alert("Failed to register. Please try again.");
      setStatus('idle');
    }
  };

  if (status === 'success') {
    return (
      <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xl flex flex-col items-center justify-center p-6 text-center animate-in fade-in duration-300">
        <div className="bg-white/10 border border-white/20 p-8 rounded-full shadow-2xl mb-8 scale-110">
          <Check className="w-16 h-16 text-green-400 drop-shadow-lg" />
        </div>
        <h2 className="text-3xl font-bold text-white mb-3 tracking-tight">Registered!</h2>
        <p className="text-slate-300 text-lg max-w-xs mx-auto leading-relaxed">
          We'll send the {formData.fileType} to {formData.name} soon.
        </p>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-gray-50">
      
      {/* iOS Header */}
      <div className="pt-12 pb-4 px-6 flex items-center justify-between bg-white/80 backdrop-blur-md sticky top-0 z-40 border-b border-gray-200/50">
        <Link to="/" className="p-2 -ml-2 text-blue-500 font-medium flex items-center">
           <ChevronLeft className="w-5 h-5 mr-1" /> Home
        </Link>
        <span className="font-semibold text-slate-900">New Registration</span>
        <div className="w-8"></div>
      </div>

      <div className="flex-1 p-6 pb-20">
        <div className="max-w-md mx-auto space-y-8">
          
          <div className="text-center space-y-2 mt-4">
             <div className="w-16 h-16 bg-blue-100 rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-sm text-blue-600">
               <User className="w-8 h-8" />
             </div>
             <h1 className="text-2xl font-bold text-slate-900">Customer Details</h1>
             <p className="text-slate-500">Enter information to queue the {formData.fileType}.</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-6">
            
            {/* Event Selector */}
            {!loadingEvents && events.length > 0 && (
                <div className="space-y-2">
                    <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider ml-1">Select Event</label>
                    <div className="relative">
                        <Calendar className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                        <select 
                            value={formData.eventId}
                            onChange={(e) => setFormData({...formData, eventId: e.target.value})}
                            className="w-full pl-12 pr-4 py-4 bg-white border-2 border-slate-100 rounded-2xl text-slate-900 font-medium focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10 transition-all appearance-none outline-none"
                        >
                            {events.map(ev => (
                                <option key={ev.id} value={ev.id}>{ev.name}</option>
                            ))}
                        </select>
                    </div>
                </div>
            )}

            <div className="space-y-2">
              <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider ml-1">Full Name</label>
              <div className="relative group">
                <User className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400 group-focus-within:text-blue-500 transition-colors" />
                <input
                  type="text"
                  required
                  placeholder="e.g. John Doe"
                  className="w-full pl-12 pr-4 py-4 bg-white border-2 border-slate-100 rounded-2xl text-lg font-medium placeholder:text-slate-300 focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10 transition-all outline-none"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                />
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider ml-1">WhatsApp Number</label>
              <div className="flex gap-2">
                  <div className="relative w-24">
                      <input 
                        type="text" 
                        value={countryCode}
                        onChange={(e) => setCountryCode(e.target.value)}
                        className="w-full h-full text-center py-4 bg-white border-2 border-slate-100 rounded-2xl text-lg font-medium placeholder:text-slate-300 focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10 transition-all outline-none font-mono"
                        placeholder="+94"
                      />
                  </div>
                  <div className="relative group flex-1">
                    <input
                      type="tel"
                      required
                      placeholder="77 123 4567"
                      className="w-full px-4 py-4 bg-white border-2 border-slate-100 rounded-2xl text-lg font-medium placeholder:text-slate-300 focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10 transition-all outline-none font-mono"
                      value={formData.phone}
                      onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                    />
                  </div>
              </div>
            </div>

            {/* File Type Selection Removed - Automatically determined by Event */}

            <div className="space-y-2">
              <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider ml-1">File Name</label>
              <div className="relative group">
                <Video className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400 group-focus-within:text-blue-500 transition-colors" />
                <input
                  type="text"
                  required
                  placeholder="e.g. 001"
                  className="w-full pl-12 pr-4 py-4 bg-white border-2 border-slate-100 rounded-2xl text-lg font-medium placeholder:text-slate-300 focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10 transition-all outline-none font-mono"
                  value={formData.videoName}
                  onChange={(e) => setFormData({ ...formData, videoName: e.target.value })}
                />
                <div className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 text-sm font-bold bg-slate-100 px-2 py-1 rounded">
                    {formData.fileType === 'photo' ? '.JPG' : '.MP4'}
                </div>
              </div>
            </div>

            <button
              type="submit"
              disabled={status === 'submitting'}
              className="w-full py-4 bg-blue-600 hover:bg-blue-700 active:scale-[0.98] text-white font-bold text-lg rounded-2xl shadow-xl shadow-blue-500/20 transition-all disabled:opacity-70 disabled:cursor-not-allowed flex items-center justify-center"
            >
              {status === 'submitting' ? (
                <Loader2 className="w-6 h-6 animate-spin" />
              ) : (
                <>Register Customer</>
              )}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
};

export default MobileRegister;