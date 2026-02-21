import React, { useState, useEffect, useCallback, useRef } from 'react';
import { UploadCloud, CheckCircle, RefreshCw, FileVideo, Loader2, Search, ArrowLeft, Filter, Layers, AlertCircle, HardDrive, Trash2, Send, Wifi, WifiOff, QrCode, LogOut, RotateCw, Calendar, Plus, Image as ImageIcon, Film, Download, Edit2, X, Save, MessageSquare } from 'lucide-react';
import { CustomerRequest, Event } from '../types';
import { getPendingRequests, getFailedRequests, uploadDocument, getServerFiles, deleteServerFile, retryServerFile, deleteRequest, ServerFile, getWhatsAppStatus, WhatsAppStatus, getEvents, createEvent, getCompletedRequests, downloadCSV, updateCustomer, updateEvent, deleteEvent } from '../services/api';
import { useNavigate } from 'react-router-dom';

type TabView = 'queue' | 'issues' | 'sent' | 'storage';

const DesktopDashboard: React.FC = () => {
  const [requests, setRequests] = useState<CustomerRequest[]>([]);
  const [failedRequests, setFailedRequests] = useState<CustomerRequest[]>([]);
  const [completedRequests, setCompletedRequests] = useState<CustomerRequest[]>([]);
  const [serverFiles, setServerFiles] = useState<ServerFile[]>([]);
  const [events, setEvents] = useState<Event[]>([]);
  const [selectedEventId, setSelectedEventId] = useState<string>(''); // '' means All Events
  
  const [isLoading, setIsLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<TabView>('queue');
  
  // Create Event Modal
  const [showCreateEvent, setShowCreateEvent] = useState(false);
  const [newEventName, setNewEventName] = useState('');
  const [newEventFileType, setNewEventFileType] = useState<'video' | 'photo'>('video');
  const [newEventMessage, setNewEventMessage] = useState('Hello {{name}}! Here is your document: {{filename}}');

  // Edit Event Modal
  const [showEditEvent, setShowEditEvent] = useState(false);

  // Edit Customer Modal
  const [editingCustomer, setEditingCustomer] = useState<CustomerRequest | null>(null);
  const [editForm, setEditForm] = useState({ name: '', phone: '', videoName: '' });

  // Connection Status
  const [waStatus, setWaStatus] = useState<WhatsAppStatus>({ status: 'INITIALIZING', qr: null, queueLength: 0 });
  const [showQr, setShowQr] = useState(false);

  // Batch Upload States
  const [isProcessingBatch, setIsProcessingBatch] = useState(false);
  const [batchProgress, setBatchProgress] = useState({ current: 0, total: 0, successes: 0, failed: 0, unmatched: 0 });
  const [lastBatchReport, setLastBatchReport] = useState<{ message: string, type: 'success' | 'warning' } | null>(null);

  // Queue System for Continuous Uploads
  const fileQueueRef = useRef<{ file: File, request: CustomerRequest }[]>([]);
  const isUploadingRef = useRef(false);

  const [searchTerm, setSearchTerm] = useState('');
  const navigate = useNavigate();

  const fetchData = useCallback(async () => {
    // Allowed to run during uploads for live feedback
    setIsLoading(true);
    
    // Fetch Events first
    const eventsData = await getEvents();
    setEvents(eventsData);
    
    // Fetch Lists based on selected event
    const pendingData = await getPendingRequests(selectedEventId);
    setRequests(pendingData);
    
    const failedData = await getFailedRequests(selectedEventId);
    setFailedRequests(failedData);
    
    const completedData = await getCompletedRequests(selectedEventId);
    setCompletedRequests(completedData);

    const files = await getServerFiles();
    setServerFiles(files);
    
    setIsLoading(false);
  }, [selectedEventId]);

  // Status Polling
  useEffect(() => {
    const statusInterval = setInterval(async () => {
        const status = await getWhatsAppStatus();
        setWaStatus(status);
        if (status.status === 'QR_READY' && !showQr) {
            // Optional: Auto popup
        }
    }, 3000);
    return () => clearInterval(statusInterval);
  }, []);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 8000);
    return () => clearInterval(interval);
  }, [fetchData]);

  const normalize = (str: string) => str.toLowerCase().replace(/[^a-z0-9]/g, '');

  const handleLogout = () => {
      localStorage.removeItem('isAuthenticated');
      navigate('/login');
  };

  const handleCreateEvent = async (e: React.FormEvent) => {
      e.preventDefault();
      if(!newEventName) return;
      await createEvent(newEventName, newEventFileType, newEventMessage);
      setNewEventName('');
      setNewEventFileType('video');
      setNewEventMessage('Hello {{name}}! Here is your document: {{filename}}');
      setShowCreateEvent(false);
      fetchData();
  };

  const handleUpdateEvent = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedEventId || !newEventName) return;
    await updateEvent(selectedEventId, newEventName, newEventFileType, newEventMessage);
    setNewEventName('');
    setNewEventFileType('video');
    setNewEventMessage('Hello {{name}}! Here is your document: {{filename}}');
    setShowEditEvent(false);
    fetchData();
  };

  const handleDeleteEvent = async () => {
    if (!selectedEventId) return;
    if (!window.confirm("Are you sure you want to delete this event? This cannot be undone.")) return;
    await deleteEvent(selectedEventId);
    setSelectedEventId('');
    fetchData();
  };

  const openEditEventModal = () => {
      const ev = events.find(e => e.id === selectedEventId);
      if (ev) {
          setNewEventName(ev.name);
          setNewEventFileType(ev.defaultFileType);
          setNewEventMessage(ev.messageTemplate || "Hello {{name}}! Here is your document: {{filename}}");
          setShowEditEvent(true);
      }
  };

  // --- EDIT MODAL HANDLERS ---
  const openEditModal = (req: CustomerRequest) => {
    setEditingCustomer(req);
    setEditForm({ name: req.customerName, phone: req.phoneNumber, videoName: req.videoName });
  };

  const handleSaveEdit = async () => {
    if (!editingCustomer) return;
    const success = await updateCustomer(editingCustomer.id, editForm.name, editForm.phone, editForm.videoName);
    if (success) {
        setEditingCustomer(null);
        fetchData();
    } else {
        alert("Failed to update customer.");
    }
  };

  const handleResendFromEdit = async () => {
     if (!editingCustomer) return;
     // First save details
     await updateCustomer(editingCustomer.id, editForm.name, editForm.phone, editForm.videoName);
     // Then retry
     const res = await retryServerFile(editingCustomer.id);
     if (res.success) {
         setEditingCustomer(null);
         fetchData();
         alert("Moved to Queue for resending.");
     } else {
         alert("Failed to resend: " + res.message);
     }
  };

  // --- BATCH PROCESSOR ---
  const processFileQueue = async () => {
      if (isUploadingRef.current) return; // Already running
      isUploadingRef.current = true;
      setIsProcessingBatch(true);
      setLastBatchReport(null);

      const CONCURRENCY_LIMIT = 10; // High speed uploading

      while (fileQueueRef.current.length > 0) {
          // Take next batch
          const tasks = fileQueueRef.current.splice(0, CONCURRENCY_LIMIT);
          
          await Promise.all(tasks.map(async (task) => {
              const success = await uploadDocument(task.request.id, task.file, task.request.phoneNumber);
              
              setBatchProgress(prev => ({
                 ...prev,
                 current: prev.current + 1,
                 successes: prev.successes + (success ? 1 : 0),
                 failed: prev.failed + (success ? 0 : 1)
              }));
          }));

          // Trigger refresh to show items moving from Queue to Processing
          fetchData(); 
      }

      isUploadingRef.current = false;
      setIsProcessingBatch(false);

      // Report
      setBatchProgress(prev => {
          const message = `Completed: ${prev.successes} | Unmatched: ${prev.unmatched} | Errors: ${prev.failed}`;
          const type = (prev.failed > 0 || prev.unmatched > 0) ? 'warning' : 'success';
          setLastBatchReport({ message, type });
          return prev;
      });

      // Auto-clear report after 8s if no new uploads start
      setTimeout(() => {
          if (!isUploadingRef.current) {
              setLastBatchReport(null);
              setBatchProgress({ current: 0, total: 0, successes: 0, failed: 0, unmatched: 0 });
          }
      }, 8000);
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    if (waStatus.status !== 'READY' && waStatus.status !== 'AUTHENTICATED') {
        alert("WhatsApp is not connected. Please click the WiFi icon to scan the QR code.");
        e.target.value = '';
        return;
    }

    const fileList = Array.from(files) as File[];
    e.target.value = ''; // Reset immediately to allow continuous adds

    const newTasks: { file: File, request: CustomerRequest }[] = [];
    let unmatchedCount = 0;
    
    // We match against pending requests. 
    // To avoid duplicates in current session, we also check what's already in the queueRef.
    const queuedIds = new Set(fileQueueRef.current.map(t => t.request.id));

    for (const file of fileList) {
        const rawFileName = file.name;
        const nameWithoutExt = rawFileName.substring(0, rawFileName.lastIndexOf('.')) || rawFileName;
        const normFileName = normalize(nameWithoutExt);

        const match = requests.find(r => {
            if (r.status !== 'pending' || queuedIds.has(r.id)) return false;
            
            const normVideoName = normalize(r.videoName.substring(0, r.videoName.lastIndexOf('.')) || r.videoName);
            return normFileName.includes(normVideoName) || normVideoName.includes(normFileName);
        });

        if (match) {
            queuedIds.add(match.id);
            newTasks.push({ file, request: match });
        } else {
            unmatchedCount++;
        }
    }

    // Update Progress State (Cumulative)
    setBatchProgress(prev => ({
        ...prev,
        total: prev.total + newTasks.length + unmatchedCount,
        unmatched: prev.unmatched + unmatchedCount,
        current: prev.current + unmatchedCount // Unmatched are considered "processed/skipped" instantly
    }));

    // Add valid tasks to queue
    fileQueueRef.current.push(...newTasks);

    // Start processor if not running
    processFileQueue();
  };

  const handleRetry = async (id: string, e: React.MouseEvent) => {
      e.stopPropagation();
      const res = await retryServerFile(id);
      if (res.success) {
          alert("Retrying... Item moved to Queue.");
          fetchData();
      } else {
          alert("Failed to retry: " + res.message);
      }
  };

  const handleDeleteRequest = async (id: string, e: React.MouseEvent) => {
      e.stopPropagation();
      if (!window.confirm("Delete this request history?")) return;
      await deleteRequest(id);
      fetchData();
  };

  const handleDeleteFile = async (filename: string, e: React.MouseEvent) => {
      e.stopPropagation();
      if (!window.confirm("Permanently delete file?")) return;
      await deleteServerFile(filename);
      fetchData();
  };

  // Helper to determine list based on tab
  const getList = () => {
      switch(activeTab) {
          case 'queue': return requests;
          case 'issues': return failedRequests;
          case 'sent': return completedRequests;
          default: return [];
      }
  };

  const listData = getList().filter(r => 
    r.customerName.toLowerCase().includes(searchTerm.toLowerCase()) ||
    r.videoName.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="flex h-screen bg-white font-sans text-slate-900 overflow-hidden relative">
      
      {/* MODAL: Create Event */}
      {showCreateEvent && (
          <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
              <div className="bg-white rounded-2xl shadow-xl p-6 w-full max-w-sm">
                  <h3 className="text-lg font-bold mb-4">Create New Event</h3>
                  <form onSubmit={handleCreateEvent}>
                      <div className="mb-4">
                        <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Event Name</label>
                        <input 
                            type="text" 
                            placeholder="e.g. Wedding John & Jane" 
                            className="w-full border border-slate-300 rounded-lg px-4 py-2 focus:ring-2 focus:ring-blue-500 outline-none"
                            value={newEventName}
                            onChange={e => setNewEventName(e.target.value)}
                            autoFocus
                        />
                      </div>
                      
                      <div className="mb-4">
                        <label className="block text-xs font-bold text-slate-500 uppercase mb-2">Default File Format</label>
                        <div className="grid grid-cols-2 gap-2">
                           <button
                             type="button"
                             onClick={() => setNewEventFileType('video')}
                             className={`px-3 py-2 rounded-lg text-sm font-medium flex items-center justify-center gap-2 border transition-all ${newEventFileType === 'video' ? 'bg-blue-50 text-blue-600 border-blue-200 ring-2 ring-blue-500/20' : 'bg-white text-slate-500 border-slate-200 hover:bg-slate-50'}`}
                           >
                              <Film className="w-4 h-4" /> Video
                           </button>
                           <button
                             type="button"
                             onClick={() => setNewEventFileType('photo')}
                             className={`px-3 py-2 rounded-lg text-sm font-medium flex items-center justify-center gap-2 border transition-all ${newEventFileType === 'photo' ? 'bg-purple-50 text-purple-600 border-purple-200 ring-2 ring-purple-500/20' : 'bg-white text-slate-500 border-slate-200 hover:bg-slate-50'}`}
                           >
                              <ImageIcon className="w-4 h-4" /> Photo
                           </button>
                        </div>
                      </div>

                      <div className="mb-6">
                        <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Message Template</label>
                        <textarea 
                            className="w-full border border-slate-300 rounded-lg px-4 py-2 focus:ring-2 focus:ring-blue-500 outline-none text-sm h-24 resize-none"
                            value={newEventMessage}
                            onChange={e => setNewEventMessage(e.target.value)}
                            placeholder="Hello {{name}}! Here is your file..."
                        />
                        <p className="text-[10px] text-slate-400 mt-1">Use <b>{'{{name}}'}</b> for customer name and <b>{'{{filename}}'}</b> for file name.</p>
                      </div>

                      <div className="flex justify-end gap-2">
                          <button type="button" onClick={() => setShowCreateEvent(false)} className="px-4 py-2 text-slate-500 hover:bg-slate-100 rounded-lg text-sm font-medium">Cancel</button>
                          <button type="submit" className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm font-medium">Create Event</button>
                      </div>
                  </form>
              </div>
          </div>
      )}

      {/* MODAL: Edit Event */}
      {showEditEvent && (
          <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
              <div className="bg-white rounded-2xl shadow-xl p-6 w-full max-w-sm">
                  <h3 className="text-lg font-bold mb-4">Edit Event Details</h3>
                  <form onSubmit={handleUpdateEvent}>
                      <div className="mb-4">
                        <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Event Name</label>
                        <input 
                            type="text" 
                            className="w-full border border-slate-300 rounded-lg px-4 py-2 focus:ring-2 focus:ring-blue-500 outline-none"
                            value={newEventName}
                            onChange={e => setNewEventName(e.target.value)}
                            autoFocus
                        />
                      </div>
                      
                      <div className="mb-4">
                        <label className="block text-xs font-bold text-slate-500 uppercase mb-2">Default File Format</label>
                        <div className="grid grid-cols-2 gap-2">
                           <button
                             type="button"
                             onClick={() => setNewEventFileType('video')}
                             className={`px-3 py-2 rounded-lg text-sm font-medium flex items-center justify-center gap-2 border transition-all ${newEventFileType === 'video' ? 'bg-blue-50 text-blue-600 border-blue-200 ring-2 ring-blue-500/20' : 'bg-white text-slate-500 border-slate-200 hover:bg-slate-50'}`}
                           >
                              <Film className="w-4 h-4" /> Video
                           </button>
                           <button
                             type="button"
                             onClick={() => setNewEventFileType('photo')}
                             className={`px-3 py-2 rounded-lg text-sm font-medium flex items-center justify-center gap-2 border transition-all ${newEventFileType === 'photo' ? 'bg-purple-50 text-purple-600 border-purple-200 ring-2 ring-purple-500/20' : 'bg-white text-slate-500 border-slate-200 hover:bg-slate-50'}`}
                           >
                              <ImageIcon className="w-4 h-4" /> Photo
                           </button>
                        </div>
                      </div>

                      <div className="mb-6">
                        <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Message Template</label>
                        <textarea 
                            className="w-full border border-slate-300 rounded-lg px-4 py-2 focus:ring-2 focus:ring-blue-500 outline-none text-sm h-24 resize-none"
                            value={newEventMessage}
                            onChange={e => setNewEventMessage(e.target.value)}
                        />
                        <p className="text-[10px] text-slate-400 mt-1">Use <b>{'{{name}}'}</b> for customer name and <b>{'{{filename}}'}</b> for file name.</p>
                      </div>

                      <div className="flex justify-end gap-2">
                          <button type="button" onClick={() => setShowEditEvent(false)} className="px-4 py-2 text-slate-500 hover:bg-slate-100 rounded-lg text-sm font-medium">Cancel</button>
                          <button type="submit" className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm font-medium">Update Event</button>
                      </div>
                  </form>
              </div>
          </div>
      )}

      {/* MODAL: Edit Customer */}
      {editingCustomer && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
           <div className="bg-white rounded-2xl shadow-xl p-6 w-full max-w-sm animate-in zoom-in-95">
              <div className="flex justify-between items-center mb-4">
                 <h3 className="text-lg font-bold">Edit Customer</h3>
                 <button onClick={() => setEditingCustomer(null)} className="text-slate-400 hover:text-slate-600"><X className="w-5 h-5"/></button>
              </div>
              
              <div className="space-y-4">
                  <div>
                      <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Name</label>
                      <input 
                         type="text"
                         value={editForm.name}
                         onChange={e => setEditForm({...editForm, name: e.target.value})}
                         className="w-full border border-slate-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 outline-none"
                      />
                  </div>
                  <div>
                      <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Phone</label>
                      <input 
                         type="text"
                         value={editForm.phone}
                         onChange={e => setEditForm({...editForm, phone: e.target.value})}
                         className="w-full border border-slate-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 outline-none font-mono"
                      />
                  </div>
                  <div>
                      <label className="block text-xs font-bold text-slate-500 uppercase mb-1">File Name</label>
                      <input 
                         type="text"
                         value={editForm.videoName}
                         onChange={e => setEditForm({...editForm, videoName: e.target.value})}
                         className="w-full border border-slate-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 outline-none font-mono"
                      />
                  </div>
              </div>

              <div className="flex justify-end gap-2 mt-6">
                   {editingCustomer.status === 'failed' && (
                       <button onClick={handleResendFromEdit} className="mr-auto px-4 py-2 bg-red-100 text-red-700 rounded-lg hover:bg-red-200 text-sm font-bold flex items-center gap-1">
                           <RotateCw className="w-4 h-4" /> Resend
                       </button>
                   )}
                   <button onClick={handleSaveEdit} className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm font-bold flex items-center gap-1">
                       <Save className="w-4 h-4" /> Save
                   </button>
              </div>
           </div>
        </div>
      )}

      {/* QR CODE MODAL */}
      {showQr && (
          <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in">
              <div className="bg-white rounded-2xl shadow-2xl p-8 max-w-sm w-full text-center relative">
                  <button onClick={() => setShowQr(false)} className="absolute top-4 right-4 text-slate-400 hover:text-slate-600">
                      <Trash2 className="w-5 h-5 rotate-45" />
                  </button>
                  <h2 className="text-xl font-bold mb-2">Connect WhatsApp</h2>
                  <p className="text-sm text-slate-500 mb-6">Open WhatsApp &gt; Linked Devices &gt; Link a Device</p>
                  <div className="bg-slate-100 p-4 rounded-xl aspect-square flex items-center justify-center mb-4">
                      {waStatus.status === 'QR_READY' && waStatus.qr ? (
                          <img src={waStatus.qr} alt="Scan QR" className="w-full h-full object-contain" />
                      ) : waStatus.status === 'READY' || waStatus.status === 'AUTHENTICATED' ? (
                          <div className="flex flex-col items-center text-green-600">
                              <CheckCircle className="w-16 h-16 mb-2" />
                              <span className="font-bold">Connected!</span>
                          </div>
                      ) : (
                          <div className="flex flex-col items-center text-slate-400">
                              <Loader2 className="w-8 h-8 animate-spin mb-2" />
                              <span>Loading...</span>
                          </div>
                      )}
                  </div>
                  <button onClick={() => setShowQr(false)} className="w-full py-2 bg-slate-100 hover:bg-slate-200 rounded-lg text-sm font-medium">Close</button>
              </div>
          </div>
      )}

      {/* SIDEBAR */}
      <div className="w-80 bg-slate-50 border-r border-slate-200 flex flex-col">
        <div className="h-16 flex items-center justify-between px-6 border-b border-slate-200 bg-white">
            <span className="font-bold text-lg tracking-tight">Dashboard</span>
            <button onClick={handleLogout} className="text-slate-400 hover:text-red-500 transition-colors" title="Logout">
                <LogOut className="w-5 h-5" />
            </button>
        </div>

        {/* TABS */}
        <div className="flex p-2 gap-1 bg-slate-50 border-b border-slate-200">
          <button onClick={() => setActiveTab('queue')} className={`flex-1 py-1.5 text-xs font-semibold rounded-md flex items-center justify-center gap-1 transition-all ${activeTab === 'queue' ? 'bg-white shadow-sm text-blue-600' : 'text-slate-500 hover:bg-slate-100'}`}>
            Queue <span className="bg-slate-100 px-1.5 rounded-full text-[10px] text-slate-600 border border-slate-200">{requests.length}</span>
          </button>
          <button onClick={() => setActiveTab('issues')} className={`flex-1 py-1.5 text-xs font-semibold rounded-md flex items-center justify-center gap-1 transition-all ${activeTab === 'issues' ? 'bg-red-50 shadow-sm text-red-600 border border-red-100' : 'text-slate-500 hover:bg-slate-100'}`}>
            Issues <span className={`px-1.5 rounded-full text-[10px] border ${failedRequests.length > 0 ? 'bg-red-100 text-red-700 border-red-200' : 'bg-slate-100 text-slate-500 border-slate-200'}`}>{failedRequests.length}</span>
          </button>
           <button onClick={() => setActiveTab('sent')} className={`flex-1 py-1.5 text-xs font-semibold rounded-md flex items-center justify-center gap-1 transition-all ${activeTab === 'sent' ? 'bg-green-50 shadow-sm text-green-600 border border-green-100' : 'text-slate-500 hover:bg-slate-100'}`}>
            Sent
          </button>
          <button onClick={() => setActiveTab('storage')} className={`flex-1 py-1.5 text-xs font-semibold rounded-md flex items-center justify-center gap-1 transition-all ${activeTab === 'storage' ? 'bg-purple-50 shadow-sm text-purple-600 border border-purple-100' : 'text-slate-500 hover:bg-slate-100'}`}>
            Storage
          </button>
        </div>

        <div className="p-4 flex flex-col flex-1 overflow-hidden">
          {activeTab !== 'storage' && (
             <div className="relative mb-6">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-slate-400" />
                <input 
                  type="text" 
                  placeholder="Search..." 
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full bg-white border border-slate-200 rounded-xl pl-10 pr-4 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none shadow-sm"
                />
             </div>
          )}
          
          <div className="space-y-2 overflow-y-auto flex-1 custom-scrollbar pr-1">
             {activeTab === 'storage' ? (
                // STORAGE LIST
                serverFiles.length === 0 ? (
                    <div className="text-center py-12 text-slate-400">
                        <HardDrive className="w-8 h-8 mx-auto mb-2 opacity-50" />
                        <p className="text-sm">Storage Empty</p>
                    </div>
                ) : (
                    serverFiles.map((file, idx) => (
                        <div key={idx} className="p-3 rounded-xl bg-white border border-purple-100 shadow-sm flex items-center justify-between group">
                            <div className="overflow-hidden">
                                <p className="font-semibold text-xs text-slate-700 truncate w-40">{file.name}</p>
                                <p className="text-[10px] text-slate-400 mt-0.5">{file.size} • {new Date(file.created).toLocaleDateString()}</p>
                            </div>
                            <button onClick={(e) => handleDeleteFile(file.name, e)} className="p-2 hover:bg-red-50 rounded-lg text-slate-300 hover:text-red-500 transition-colors">
                                <Trash2 className="w-4 h-4" />
                            </button>
                        </div>
                    ))
                )
             ) : (
                // REQUESTS LIST (Queue, Issues, Sent)
                isLoading && listData.length === 0 ? (
                    <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-slate-400"/></div>
                 ) : !isLoading && listData.length === 0 ? (
                    <div className="text-center py-12 text-slate-400">
                      <Filter className="w-8 h-8 mx-auto mb-2 opacity-50" />
                      <p className="text-sm">No items found</p>
                    </div>
                 ) : (
                    listData.map((req) => (
                      <div 
                        key={req.id} 
                        onClick={() => openEditModal(req)}
                        className={`group p-4 rounded-xl bg-white border shadow-sm transition-all relative overflow-hidden cursor-pointer hover:shadow-md ${activeTab === 'issues' ? 'border-red-100' : 'border-slate-100'}`}
                      >
                        <div className={`absolute left-0 top-0 bottom-0 w-1 rounded-l-xl opacity-0 group-hover:opacity-100 transition-opacity ${activeTab === 'issues' ? 'bg-red-500' : activeTab === 'sent' ? 'bg-green-500' : 'bg-blue-500'}`}></div>
                        
                        <div className="flex justify-between items-start mb-1">
                          <span className="font-semibold text-slate-800 text-sm truncate pr-2">{req.customerName}</span>
                          <div className="flex gap-2">
                             {activeTab === 'issues' && (
                                  <button onClick={(e) => handleRetry(req.id, e)} className="text-slate-400 hover:text-blue-500" title="Retry">
                                     <RotateCw className="w-3.5 h-3.5" />
                                  </button>
                             )}
                             {activeTab === 'sent' && req.completedAt && (new Date().getTime() - new Date(req.completedAt).getTime() < 24 * 60 * 60 * 1000) && (
                                  <button onClick={(e) => handleRetry(req.id, e)} className="text-slate-400 hover:text-blue-500" title="Resend (Available for 24h)">
                                     <RotateCw className="w-3.5 h-3.5" />
                                  </button>
                             )}
                             <button onClick={(e) => handleDeleteRequest(req.id, e)} className="text-slate-400 hover:text-red-500" title="Delete">
                                     <Trash2 className="w-3.5 h-3.5" />
                             </button>
                          </div>
                        </div>
                        
                        <div className="flex items-center text-xs text-slate-500 mt-1">
                          {req.fileType === 'photo' ? (
                             <ImageIcon className={`w-3 h-3 mr-1.5 ${activeTab === 'issues' ? 'text-red-400' : activeTab === 'sent' ? 'text-green-500' : 'text-blue-500'}`} />
                          ) : (
                             <FileVideo className={`w-3 h-3 mr-1.5 ${activeTab === 'issues' ? 'text-red-400' : activeTab === 'sent' ? 'text-green-500' : 'text-blue-500'}`} />
                          )}
                          <span className="font-mono bg-slate-50 px-1.5 py-0.5 rounded border border-slate-100 truncate max-w-[150px]">{req.videoName}</span>
                        </div>
                        
                        {activeTab === 'issues' && (req as any).error && (
                          <div className="mt-2 pt-2 border-t border-red-50 flex items-start gap-1.5 text-[11px] text-red-600 bg-red-50/50 p-1.5 rounded">
                            <AlertCircle className="w-3 h-3 flex-shrink-0 mt-0.5" />
                            <span className="break-words leading-tight">{(req as any).error}</span>
                          </div>
                        )}
                        
                         {activeTab === 'sent' && (
                          <div className="mt-2 pt-1 border-t border-slate-50 flex items-center justify-between text-[10px] text-slate-400">
                             <span>{(req as any).completedAt ? new Date((req as any).completedAt).toLocaleTimeString() : ''}</span>
                             <CheckCircle className="w-3 h-3 text-green-500" />
                          </div>
                        )}
                      </div>
                    ))
                 )
             )}
          </div>
        </div>

        <div className="p-4 border-t border-slate-200 bg-slate-50">
           {activeTab === 'sent' && (
              <button 
                 onClick={() => downloadCSV('completed', selectedEventId)}
                 className="flex items-center justify-center w-full py-2.5 bg-green-50 border border-green-200 hover:bg-green-100 rounded-xl text-sm font-bold text-green-700 transition-all shadow-sm mb-2"
              >
                  <Download className="w-3.5 h-3.5 mr-2" /> Export CSV
              </button>
           )}
           {activeTab === 'issues' && (
              <button 
                 onClick={() => downloadCSV('failed', selectedEventId)}
                 className="flex items-center justify-center w-full py-2.5 bg-red-50 border border-red-200 hover:bg-red-100 rounded-xl text-sm font-bold text-red-700 transition-all shadow-sm mb-2"
              >
                  <Download className="w-3.5 h-3.5 mr-2" /> Export CSV
              </button>
           )}

           <button onClick={() => fetchData()} className="flex items-center justify-center w-full py-2.5 bg-white border border-slate-200 hover:border-slate-300 hover:bg-slate-50 rounded-xl text-sm font-medium text-slate-600 transition-all shadow-sm">
              <RefreshCw className={`w-3.5 h-3.5 mr-2 ${isLoading ? 'animate-spin' : ''}`} /> Refresh
           </button>
        </div>
      </div>

      {/* MAIN CONTENT AREA */}
      <div className="flex-1 flex flex-col relative bg-white">
        
        {/* Top Navigation Bar */}
        <header className="h-16 border-b border-slate-100 flex items-center justify-between px-8 bg-white/80 backdrop-blur-sm z-10 sticky top-0">
           <div className="flex items-center gap-6">
               <h1 className="font-bold text-xl text-slate-900 flex items-center gap-2">
                 <Layers className="w-5 h-5 text-blue-500" />
                 Upload Center
               </h1>
               
               {/* Event Filter */}
               <div className="flex items-center bg-slate-50 rounded-lg p-1 border border-slate-200">
                    <div className="px-3 text-xs font-bold text-slate-500 uppercase">Event:</div>
                    <select 
                        value={selectedEventId} 
                        onChange={(e) => setSelectedEventId(e.target.value)}
                        className="bg-transparent text-sm font-semibold text-slate-700 outline-none cursor-pointer"
                    >
                        <option value="">All Events</option>
                        {events.map(ev => (
                            <option key={ev.id} value={ev.id}>{ev.name}</option>
                        ))}
                    </select>
                    <button onClick={() => setShowCreateEvent(true)} className="ml-2 p-1 hover:bg-blue-100 rounded text-blue-600" title="Create Event">
                        <Plus className="w-4 h-4" />
                    </button>
                    {selectedEventId && (
                        <>
                            <button onClick={openEditEventModal} className="ml-1 p-1 hover:bg-slate-200 rounded text-slate-500" title="Edit Event">
                                <Edit2 className="w-4 h-4" />
                            </button>
                            <button onClick={handleDeleteEvent} className="ml-1 p-1 hover:bg-red-100 rounded text-red-500" title="Delete Event">
                                <Trash2 className="w-4 h-4" />
                            </button>
                        </>
                    )}
               </div>

               {(waStatus.queueLength || 0) > 0 && (
                   <span className="px-3 py-1 bg-blue-100 text-blue-700 text-xs font-bold rounded-full flex items-center animate-pulse">
                       Sending: {waStatus.queueLength} in Queue
                   </span>
               )}
           </div>
           
           <div className="flex items-center space-x-4">
              <button 
                  onClick={() => setShowQr(true)}
                  className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-bold border transition-all ${
                      waStatus.status === 'READY' || waStatus.status === 'AUTHENTICATED' 
                      ? 'bg-green-50 text-green-700 border-green-100 hover:bg-green-100' 
                      : 'bg-red-50 text-red-700 border-red-100 hover:bg-red-100'
                  }`}
              >
                {waStatus.status === 'READY' || waStatus.status === 'AUTHENTICATED' ? (
                    <><Wifi className="w-3 h-3" /> CONNECTED</>
                ) : (
                    <><QrCode className="w-3 h-3" /> {waStatus.status === 'QR_READY' ? 'SCAN QR' : 'CONNECTING...'}</>
                )}
              </button>
           </div>
        </header>

        {/* Upload Zone */}
        <main className="flex-1 p-8 flex flex-col items-center justify-center bg-[radial-gradient(#e2e8f0_1px,transparent_1px)] [background-size:20px_20px]">
           <div className="w-full max-w-3xl">
              <div className="relative group">
                <div className="absolute -inset-1 bg-gradient-to-r from-blue-100 to-purple-100 rounded-[2rem] blur opacity-25 group-hover:opacity-75 transition duration-1000 group-hover:duration-200"></div>
                <div className={`relative aspect-[2/1] bg-white rounded-[1.8rem] border-2 border-dashed ${isProcessingBatch ? 'border-blue-400 bg-blue-50/30' : 'border-slate-200 hover:border-blue-500 hover:bg-blue-50/10'} transition-all flex flex-col items-center justify-center cursor-pointer overflow-hidden shadow-xl shadow-slate-200/50`}>
                  <input 
                    type="file" 
                    multiple 
                    className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-40"
                    onChange={handleFileChange}
                    accept="video/*,application/pdf,image/*"
                  />
                  
                  {isProcessingBatch ? (
                    <div className="flex flex-col items-center animate-in fade-in zoom-in-95 duration-300">
                       <Loader2 className="w-16 h-16 text-blue-500 animate-spin mb-4" />
                       <h3 className="text-2xl font-bold text-slate-800 mb-2">Processing Batch...</h3>
                       <div className="w-64 h-2 bg-slate-100 rounded-full overflow-hidden mt-2">
                          <div className="h-full bg-blue-500 transition-all duration-300 ease-out" style={{ width: `${(batchProgress.current / batchProgress.total) * 100}%` }} />
                       </div>
                       <p className="text-slate-500 mt-3 font-mono text-sm">{batchProgress.current} / {batchProgress.total} Files</p>
                       <p className="text-xs text-blue-400 mt-2">You can continue dropping files...</p>
                    </div>
                  ) : lastBatchReport ? (
                    <div className="flex flex-col items-center animate-in fade-in zoom-in-95 duration-300">
                       <div className={`p-6 rounded-full mb-4 ${lastBatchReport.type === 'success' ? 'bg-green-50' : 'bg-orange-50'}`}>
                         {lastBatchReport.type === 'success' ? <CheckCircle className="w-12 h-12 text-green-500" /> : <AlertCircle className="w-12 h-12 text-orange-500" />}
                       </div>
                       <h3 className="text-xl font-bold text-slate-800 mb-2">{lastBatchReport.message}</h3>
                       <p className="text-slate-400 text-sm">
                           {lastBatchReport.type === 'success' ? 'All files queued for safe sending.' : 'Check Issues tab for errors.'}
                       </p>
                    </div>
                  ) : (
                    <>
                      <div className="bg-slate-50 p-6 rounded-full mb-6 group-hover:scale-110 group-hover:bg-blue-100 transition-all duration-300">
                         <UploadCloud className="w-12 h-12 text-slate-400 group-hover:text-blue-600 transition-colors" />
                      </div>
                      <h3 className="text-2xl font-bold text-slate-800 mb-2">Drag & Drop Files</h3>
                      <p className="text-slate-500 text-sm max-w-sm text-center px-4 leading-relaxed">
                         Videos and Photos match automatically. <br/>Sent via safe queue (10-25s delay). <br/>Ensure WhatsApp is <b>Connected</b>.
                      </p>
                    </>
                  )}
                </div>
              </div>
           </div>
        </main>
      </div>
    </div>
  );
};

export default DesktopDashboard;