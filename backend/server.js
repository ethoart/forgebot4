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

const CustomerSchema = new mongoose.Schema({
  customerName: String,
  phoneNumber: String,
  videoName: String,
  status: { type: String, default: 'pending' },
  error: String,
  requestedAt: { type: Date, default: Date.now },
  completedAt: Date
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

        // 4. Delete File ON SUCCESS ONLY
        try { fs.unlinkSync(task.filePath); } catch(e) {}

    } catch (error) {
        console.error(`❌ Send Failed for ${task.customerName}:`, error.message);
        console.error(error); // Log full stack trace
        
        await Customer.findByIdAndUpdate(task.requestId, {
            status: 'failed',
            error: error.message || 'Send Failed'
        });
        // Note: We DO NOT delete the file on failure, so it can be retried/viewed in storage
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

// Register
app.post('/register-customer', async (req, res) => {
  try {
    const { name, phone, videoName } = req.body;
    const newCustomer = new Customer({ customerName: name, phoneNumber: phone, videoName });
    await newCustomer.save();
    res.json({ success: true, id: newCustomer._id });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

// Getters
app.get('/get-pending', async (req, res) => {
  const docs = await Customer.find({ status: 'pending' }).sort({ requestedAt: 1 }).limit(100);
  res.json(docs.map(d => ({ id: d._id, customerName: d.customerName, phoneNumber: d.phoneNumber, videoName: d.videoName, status: d.status, requestedAt: d.requestedAt })));
});

app.get('/get-failed', async (req, res) => {
  const docs = await Customer.find({ status: 'failed' }).sort({ requestedAt: -1 }).limit(50);
  res.json(docs.map(d => ({ id: d._id, customerName: d.customerName, phoneNumber: d.phoneNumber, videoName: d.videoName, status: d.status, requestedAt: d.requestedAt, error: d.error })));
});

// Upload & Queue
app.post('/upload-document', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file.' });
  
  const { requestId, phoneNumber, videoName } = req.body;
  
  // Update DB to Processing
  await Customer.findByIdAndUpdate(requestId, { status: 'processing' });

  // Add to Queue
  messageQueue.push({
      requestId,
      phoneNumber,
      customerName: videoName, // Using videoName as rough name if needed, or query DB. Ideally pass name.
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

        // Check if file exists in uploads
        // We assume filename matches videoName roughly or we need to find it. 
        // In this simple system, we rely on the file still being there matching the videoName logic if possible, 
        // OR we can't retry if the file is gone. 
        // Improvement: We iterate files to find a match.
        
        const files = fs.readdirSync(uploadDir);
        // Clean matching logic
        const normalize = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
        const target = normalize(doc.videoName);
        
        const match = files.find(f => normalize(f).includes(target));

        if (!match) {
            return res.status(400).json({ error: 'Original file missing from server storage.' });
        }

        const filePath = path.join(uploadDir, match);

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