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

// --- APP SETUP ---
const app = express();
app.use(cors());
app.use(express.json());

// --- DATABASE WITH RETRY ---
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
  console.error('💀 MongoDB failed to connect after multiple attempts. Exiting...');
  process.exit(1);
};

// Define Models immediately
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

// Start DB connection
connectWithRetry();

// --- WHATSAPP CLIENT SETUP ---
console.log("🔄 Initializing Native WhatsApp Client...");

const AUTH_PATH = '/app/wwebjs_auth';

// CRITICAL FIX: Recursive Lock Cleaner
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
                    console.log(`✅ Removed stale lock file: ${fullPath}`);
                }
            } catch (e) {
                // Ignore errors accessing specific files (race conditions)
            }
        }
    } catch (e) {
        console.error(`Error traversing directory ${dir}:`, e);
    }
};

let qrCodeData = null;
let clientStatus = 'INITIALIZING'; // INITIALIZING, QR_READY, AUTHENTICATED, READY, DISCONNECTED
let client = null;

const initializeClient = async () => {
    // 1. Pre-emptive Clean
    cleanUpLocks(AUTH_PATH);

    // 2. Configure Client
    client = new Client({
        authStrategy: new LocalAuth({ dataPath: AUTH_PATH }),
        puppeteer: {
            headless: true,
            executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium-browser',
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-accelerated-2d-canvas',
                '--no-first-run',
                '--no-zygote',
                '--disable-gpu',
                '--disable-software-rasterizer'
            ]
        },
        webVersionCache: {
            type: 'remote',
            remotePath: 'https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/2.2412.54.html',
        }
    });

    // 3. Setup Event Listeners
    client.on('qr', (qr) => {
        console.log('⚡ QR RECEIVED');
        qrcode.toDataURL(qr, (err, url) => {
            if (!err) {
                qrCodeData = url;
                clientStatus = 'QR_READY';
            }
        });
    });

    client.on('ready', () => {
        console.log('✅ WhatsApp Client is READY!');
        clientStatus = 'READY';
        qrCodeData = null;
    });

    client.on('authenticated', () => {
        console.log('🔐 WhatsApp Authenticated');
        clientStatus = 'AUTHENTICATED';
        qrCodeData = null;
    });

    client.on('auth_failure', (msg) => {
        console.error('❌ Auth Failure', msg);
        clientStatus = 'DISCONNECTED';
    });

    client.on('disconnected', (reason) => {
        console.log('❌ WhatsApp Disconnected:', reason);
        clientStatus = 'DISCONNECTED';
        // Destroy and Re-initialize
        setTimeout(async () => {
             console.log('🔄 Reloading client...');
             try { await client.destroy(); } catch(e) {}
             initializeClient();
        }, 5000);
    });

    // 4. Initialize with Retry Logic
    try {
        await client.initialize();
    } catch (err) {
        console.error("💥 Client Initialization Failed:", err.message);
        
        // Check for Lock Errors (Code 21, SingletonLock)
        const isLockError = err.message.includes('Code: 21') || 
                            err.message.includes('SingletonLock') ||
                            err.message.includes('session');

        if (isLockError) {
             console.log("🧹 Lock file issue detected. Cleaning and retrying...");
             cleanUpLocks(AUTH_PATH);
             setTimeout(initializeClient, 5000);
        } else {
             console.log("⚠️ Unexpected error. Retrying in 10s...");
             setTimeout(initializeClient, 10000);
        }
    }
};

// Start the Client
initializeClient();

// --- FILE UPLOAD SETUP ---
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const safeName = file.originalname.replace(/[^a-zA-Z0-9.-]/g, '_');
    cb(null, safeName);
  }
});

const upload = multer({ storage: storage, limits: { fileSize: 100 * 1024 * 1024 } });

// --- ROUTES ---

app.get('/status', (req, res) => {
    res.json({
        status: clientStatus,
        qr: qrCodeData
    });
});

app.post('/register-customer', async (req, res) => {
  try {
    const { name, phone, videoName } = req.body;
    if (!name || !phone || !videoName) return res.status(400).json({ error: 'Missing fields' });

    const newCustomer = new Customer({
      customerName: name,
      phoneNumber: phone,
      videoName: videoName
    });

    await newCustomer.save();
    console.log(`📝 Registered: ${name}`);
    res.json({ success: true, id: newCustomer._id });
  } catch (error) {
    console.error("Register Error:", error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/get-pending', async (req, res) => {
  try {
    if (mongoose.connection.readyState !== 1) return res.json([]);
    const docs = await Customer.find({ status: 'pending' }).sort({ requestedAt: 1 }).limit(100);
    const mapped = docs.map(d => ({
      id: d._id,
      customerName: d.customerName,
      phoneNumber: d.phoneNumber,
      videoName: d.videoName,
      status: d.status,
      requestedAt: d.requestedAt
    }));
    res.json(mapped);
  } catch (error) {
    console.error("Get Pending Error:", error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/get-failed', async (req, res) => {
  try {
    if (mongoose.connection.readyState !== 1) return res.json([]);
    const docs = await Customer.find({ status: 'failed' }).sort({ requestedAt: -1 }).limit(50);
    const mapped = docs.map(d => ({
      id: d._id,
      customerName: d.customerName,
      phoneNumber: d.phoneNumber,
      videoName: d.videoName,
      status: d.status,
      requestedAt: d.requestedAt,
      error: d.error
    }));
    res.json(mapped);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/upload-document', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded.' });

  const { requestId, phoneNumber, videoName } = req.body;
  
  // Allow processing if Authenticated OR Ready.
  if (clientStatus !== 'READY' && clientStatus !== 'AUTHENTICATED') {
      if (req.file.path) fs.unlinkSync(req.file.path);
      return res.status(503).json({ error: 'WhatsApp client is not ready. Please scan QR code.' });
  }

  // Immediate response
  res.json({ success: true, message: 'Processing started' });

  const filePath = req.file.path;
  const originalName = req.file.originalname;

  try {
    console.log(`🔄 Processing Upload for ID: ${requestId}`);
    
    let cleanPhone = phoneNumber.replace(/[^0-9]/g, '');
    const chatId = `${cleanPhone}@c.us`;

    const media = MessageMedia.fromFilePath(filePath);
    
    console.log(`🚀 Sending Native: ${chatId} | File: ${originalName}`);
    await client.sendMessage(chatId, media, {
        caption: `Hello! Here is your document: ${videoName}`
    });

    console.log(`✅ Sent Successfully`);

    await Customer.findByIdAndUpdate(requestId, {
      status: 'completed',
      completedAt: new Date(),
      error: null
    });

  } catch (error) {
    console.error(`❌ Send Error:`, error);
    await Customer.findByIdAndUpdate(requestId, {
      status: 'failed',
      error: error.message || 'WhatsApp Send Failed'
    });
  } finally {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  }
});

app.get('/server-files', (req, res) => res.json([]));

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Backend (Native WhatsApp) listening on port ${PORT}`);
});