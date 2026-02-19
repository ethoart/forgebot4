import express from 'express';
import cors from 'cors';
import multer from 'multer';
import mongoose from 'mongoose';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pkg from 'whatsapp-web.js';
const { Client, LocalAuth, MessageMedia } = pkg;
import qrcode from 'qrcode';

// --- CONFIGURATION ---
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = 8000;
const MONGO_URI = process.env.MONGO_URI || 'mongodb://admin:secret123@mongo:27017/whatsdoc?authSource=admin';
const ADMIN_PASS = 'secret123'; // Simple password for now

// --- APP SETUP ---
const app = express();
app.use(cors());
app.use(express.json());

// --- DATABASE ---
const connectWithRetry = async () => {
  const maxRetries = 10;
  let retries = 0;
  while (retries < maxRetries) {
    try {
      await mongoose.connect(MONGO_URI, { serverSelectionTimeoutMS: 5000 });
      console.log('✅ MongoDB Connected');
      return;
    } catch (err) {
      retries++;
      console.error(`❌ MongoDB Connection Failed (Attempt ${retries}/${maxRetries}):`, err.message);
      await new Promise(res => setTimeout(res, 5000));
    }
  }
  process.exit(1);
};

// --- MODELS ---

const EventSchema = new mongoose.Schema({
    name: String,
    created: { type: Date, default: Date.now },
    isActive: { type: Boolean, default: true },
    defaultFileType: { type: String, enum: ['video', 'photo'], default: 'video' }
});
const Event = mongoose.model('Event', EventSchema);

const CustomerSchema = new mongoose.Schema({
  customerName: String,
  phoneNumber: String,
  videoName: String,
  fileType: { type: String, enum: ['video', 'photo'], default: 'video' },
  eventId: { type: mongoose.Schema.Types.ObjectId, ref: 'Event' },
  status: { type: String, default: 'pending' },
  error: String,
  requestedAt: { type: Date, default: Date.now },
  completedAt: Date,
  filePath: String // Track file path for retention policy
});
const Customer = mongoose.model('Customer', CustomerSchema);

connectWithRetry();

// --- WHATSAPP CLIENT & QUEUE ---
const AUTH_PATH = '/app/wwebjs_auth';
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

// Queue Variables
const messageQueue = [];
let isProcessingQueue = false;

// Random Delay Helper (Human Behavior)
const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));
const getRandomDelay = () => Math.floor(Math.random() * (15000 - 5000 + 1) + 5000); // 5s to 15s

const cleanUpLocks = (dir) => {
    if (!fs.existsSync(dir)) return;
    try {
        const items = fs.readdirSync(dir);
        for (const item of items) {
            const fullPath = path.join(dir, item);
            try {
                const stat = fs.lstatSync(fullPath);
                if (stat.isDirectory()) {
                    cleanUpLocks(fullPath);
                } else if (item === 'SingletonLock' || item === 'SingletonCookie' || item === 'SingletonSocket') {
                    fs.unlinkSync(fullPath);
                }
            } catch (e) {}
        }
    } catch (e) {}
};

let qrCodeData = null;
let clientStatus = 'INITIALIZING';
let client = null;

const processQueue = async () => {
    if (isProcessingQueue || messageQueue.length === 0) return;
    if (clientStatus !== 'READY' && clientStatus !== 'AUTHENTICATED') {
        // Wait and try again later if client disconnected
        setTimeout(processQueue, 5000);
        return;
    }

    isProcessingQueue = true;
    const task = messageQueue.shift(); // Get first task
    
    console.log(`🤖 Queue Processing: ${task.customerName} (${messageQueue.length} remaining)`);

    try {
        // 1. Human Delay
        const delay = getRandomDelay();
        console.log(`⏳ Waiting ${delay/1000}s to mimic human behavior...`);
        await wait(delay);

        // 2. Processing
        let cleanPhone = task.phoneNumber.replace(/[^0-9]/g, '');
        const chatId = `${cleanPhone}@c.us`;

        if (!fs.existsSync(task.filePath)) {
            throw new Error("File not found on server (maybe deleted?)");
        }

        const media = MessageMedia.fromFilePath(task.filePath);
        // Explicitly set filename ensures it sends correctly as a document
        if (!media.filename) {
            media.filename = task.videoName || path.basename(task.filePath);
        }
        
        // CRITICAL FIX: Send as document to bypass video re-encoding issues
        await client.sendMessage(chatId, media, {
            caption: `Hello ${task.customerName}! Here is your document: ${task.videoName}`,
            sendMediaAsDocument: true
        });

        console.log(`✅ Sent to ${task.customerName}`);

        // 3. Success Update
        await Customer.findByIdAndUpdate(task.requestId, {
            status: 'completed',
            completedAt: new Date(),
            error: null
        });

        // 4. WE DO NOT DELETE FILE HERE ANYMORE.
        // Files are retained for 24h via scheduled task.

    } catch (error) {
        console.error(`❌ Send Failed for ${task.customerName}:`, error.message);
        console.error(error); // Log full stack trace
        
        await Customer.findByIdAndUpdate(task.requestId, {
            status: 'failed',
            error: error.message || 'Send Failed'
        });
    }

    isProcessingQueue = false;
    processQueue(); // Process next
};

const initializeClient = async () => {
    cleanUpLocks(AUTH_PATH);
    client = new Client({
        authStrategy: new LocalAuth({ dataPath: AUTH_PATH }),
        puppeteer: {
            headless: true,
            executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium-browser',
            args: [
                '--no-sandbox', 
                '--disable-setuid-sandbox', 
                '--disable-dev-shm-usage', 
                '--disable-gpu',
                '--disable-software-rasterizer',
                '--disable-extensions'
            ],
            timeout: 0 // Disable timeout for heavy media operations
        },
        webVersionCache: { type: 'remote', remotePath: 'https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/2.2412.54.html' }
    });

    client.on('qr', (qr) => { qrcode.toDataURL(qr, (err, url) => { if(!err) { qrCodeData = url; clientStatus = 'QR_READY'; } }); });
    client.on('ready', () => { 
        console.log('✅ WhatsApp Ready'); 
        clientStatus = 'READY'; 
        qrCodeData = null; 
        processQueue(); // Trigger queue if items exist
    });
    client.on('authenticated', () => { clientStatus = 'AUTHENTICATED'; });
    client.on('disconnected', () => { 
        clientStatus = 'DISCONNECTED'; 
        setTimeout(() => { try { client.destroy(); } catch(e){} initializeClient(); }, 5000); 
    });

    try { await client.initialize(); } catch (err) { setTimeout(initializeClient, 10000); }
};

initializeClient();

const upload = multer({ 
    storage: multer.diskStorage({
        destination: (req, file, cb) => cb(null, uploadDir),
        filename: (req, file, cb) => cb(null, file.originalname.replace(/[^a-zA-Z0-9.-]/g, '_'))
    }) 
});

// --- CRON JOBS ---

// Cleanup files older than 24 hours
setInterval(async () => {
    try {
        const threshold = new Date(Date.now() - 24 * 60 * 60 * 1000); // 24 hours ago
        
        // Find completed requests older than 24h that still have a filePath
        const oldDocs = await Customer.find({ 
            status: 'completed', 
            completedAt: { $lt: threshold }, 
            filePath: { $exists: true, $ne: null } 
        });

        if (oldDocs.length > 0) {
            console.log(`🧹 Cleaning up ${oldDocs.length} old files...`);
            for (const doc of oldDocs) {
                if (doc.filePath && fs.existsSync(doc.filePath)) {
                    try {
                        fs.unlinkSync(doc.filePath);
                    } catch (e) {
                        console.error(`Failed to delete file for ${doc._id}:`, e.message);
                    }
                }
                // Unset filePath so we don't try again
                doc.filePath = undefined;
                await doc.save();
            }
        }
    } catch (e) {
        console.error("Cleanup Error:", e.message);
    }
}, 60 * 60 * 1000); // Run every hour

// --- API ROUTES ---

// Login
app.post('/login', (req, res) => {
    const { password } = req.body;
    if (password === ADMIN_PASS) return res.json({ success: true, token: 'mock-token' });
    res.status(401).json({ error: 'Invalid password' });
});

// Status
app.get('/status', (req, res) => {
    res.json({ status: clientStatus, qr: qrCodeData, queueLength: messageQueue.length });
});

// Events
app.post('/create-event', async (req, res) => {
    try {
        const { name, defaultFileType } = req.body;
        const event = new Event({ 
            name, 
            defaultFileType: defaultFileType || 'video' 
        });
        await event.save();
        res.json({ 
            id: event._id, 
            name: event.name, 
            created: event.created, 
            isActive: event.isActive,
            defaultFileType: event.defaultFileType 
        });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/update-event/:id', async (req, res) => {
    try {
        const { name, defaultFileType } = req.body;
        await Event.findByIdAndUpdate(req.params.id, { name, defaultFileType });
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/delete-event/:id', async (req, res) => {
    try {
        await Event.findByIdAndDelete(req.params.id);
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/events', async (req, res) => {
    try {
        const events = await Event.find().sort({ created: -1 });
        res.json(events.map(e => ({ 
            id: e._id, 
            name: e.name, 
            created: e.created, 
            isActive: e.isActive,
            defaultFileType: e.defaultFileType 
        })));
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// Register
app.post('/register-customer', async (req, res) => {
  try {
    const { name, phone, videoName, fileType, eventId } = req.body;
    const newCustomer = new Customer({ 
        customerName: name, 
        phoneNumber: phone, 
        videoName,
        fileType: fileType || 'video',
        eventId: eventId || null
    });
    await newCustomer.save();
    res.json({ success: true, id: newCustomer._id });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

// Update Customer Details
app.put('/update-customer/:id', async (req, res) => {
    try {
        const { name, phone, videoName } = req.body;
        await Customer.findByIdAndUpdate(req.params.id, { 
            customerName: name, 
            phoneNumber: phone, 
            videoName: videoName 
        });
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Getters (Pending, Failed, Completed)
app.get('/get-pending', async (req, res) => {
  const query = { status: 'pending' };
  if (req.query.eventId) query.eventId = req.query.eventId;
  
  const docs = await Customer.find(query).sort({ requestedAt: 1 }).limit(100);
  res.json(docs.map(d => ({ 
      id: d._id, 
      customerName: d.customerName, 
      phoneNumber: d.phoneNumber, 
      videoName: d.videoName, 
      fileType: d.fileType,
      eventId: d.eventId,
      status: d.status, 
      requestedAt: d.requestedAt 
  })));
});

app.get('/get-failed', async (req, res) => {
  const query = { status: 'failed' };
  if (req.query.eventId) query.eventId = req.query.eventId;

  const docs = await Customer.find(query).sort({ requestedAt: -1 }).limit(50);
  res.json(docs.map(d => ({ 
      id: d._id, 
      customerName: d.customerName, 
      phoneNumber: d.phoneNumber, 
      videoName: d.videoName, 
      fileType: d.fileType,
      eventId: d.eventId,
      status: d.status, 
      requestedAt: d.requestedAt, 
      error: d.error 
  })));
});

app.get('/get-completed', async (req, res) => {
  const query = { status: 'completed' };
  if (req.query.eventId) query.eventId = req.query.eventId;

  const docs = await Customer.find(query).sort({ completedAt: -1 }).limit(50);
  res.json(docs.map(d => ({ 
      id: d._id, 
      customerName: d.customerName, 
      phoneNumber: d.phoneNumber, 
      videoName: d.videoName, 
      fileType: d.fileType,
      eventId: d.eventId,
      status: d.status, 
      requestedAt: d.requestedAt, 
      completedAt: d.completedAt
  })));
});

// Export CSV
app.get('/export-csv', async (req, res) => {
    try {
        const { type, eventId } = req.query;
        // type should be 'completed' or 'failed'
        const query = { status: type };
        if (eventId) query.eventId = eventId;
        
        const docs = await Customer.find(query).sort({ requestedAt: -1 });
        
        const fields = ['customerName', 'phoneNumber', 'videoName', 'status', 'requestedAt', 'completedAt', 'error'];
        const csvRows = [
            fields.join(','), // Header
            ...docs.map(d => fields.map(f => {
                let val = d[f] ? d[f].toString() : '';
                val = val.replace(/"/g, '""'); // Escape double quotes
                return `"${val}"`;
            }).join(','))
        ];
        
        const csvContent = csvRows.join('\n');
        
        res.header('Content-Type', 'text/csv');
        res.attachment(`${type}_${eventId || 'all'}_${Date.now()}.csv`);
        res.send(csvContent);
    } catch (e) {
        res.status(500).send("Error generating CSV");
    }
});

// Upload & Queue
app.post('/upload-document', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file.' });
  
  const { requestId, phoneNumber, videoName } = req.body;
  
  // Update DB to Processing AND SAVE FILEPATH for retention
  await Customer.findByIdAndUpdate(requestId, { 
      status: 'processing',
      filePath: req.file.path
  });

  // Add to Queue
  messageQueue.push({
      requestId,
      phoneNumber,
      customerName: videoName, 
      videoName,
      filePath: req.file.path
  });

  // Trigger Processor
  processQueue();

  res.json({ success: true, message: 'Queued for safe sending' });
});

// --- NEW FEATURES ---

// Storage Listing
app.get('/server-files', (req, res) => {
    fs.readdir(uploadDir, (err, files) => {
        if (err) return res.json([]);
        const fileStats = files.map(file => {
            try {
                const stats = fs.statSync(path.join(uploadDir, file));
                return { name: file, size: (stats.size / 1024 / 1024).toFixed(2) + ' MB', created: stats.birthtime };
            } catch (e) { return null; }
        }).filter(Boolean);
        res.json(fileStats);
    });
});

// Delete File
app.delete('/delete-file/:name', (req, res) => {
    const p = path.join(uploadDir, req.params.name);
    if (fs.existsSync(p)) fs.unlinkSync(p);
    res.json({ success: true });
});

// Delete Request
app.delete('/delete-request/:id', async (req, res) => {
    await Customer.findByIdAndDelete(req.params.id);
    res.json({ success: true });
});

// Retry Request
app.post('/retry-request/:id', async (req, res) => {
    try {
        const doc = await Customer.findById(req.params.id);
        if (!doc) return res.status(404).json({ error: 'Request not found' });

        // If filePath is stored in doc, check that first
        let filePath = doc.filePath;
        
        if (!filePath || !fs.existsSync(filePath)) {
            // Fallback to name matching if path is missing (legacy support)
            const files = fs.readdirSync(uploadDir);
            const normalize = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
            const target = normalize(doc.videoName);
            const match = files.find(f => normalize(f).includes(target));
            
            if (match) {
                filePath = path.join(uploadDir, match);
                // Update doc with found path
                doc.filePath = filePath;
            } else {
                return res.status(400).json({ error: 'File missing from server storage.' });
            }
        }

        // Reset Status
        doc.status = 'processing';
        doc.error = null;
        await doc.save();

        // Push to Queue
        messageQueue.push({
            requestId: doc._id,
            phoneNumber: doc.phoneNumber,
            customerName: doc.customerName,
            videoName: doc.videoName,
            filePath: filePath
        });
        
        processQueue();

        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Backend listening on ${PORT}`);
});