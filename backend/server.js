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

// Define Models immediately so they are available
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

// Start DB connection in background
connectWithRetry();

// --- WHATSAPP CLIENT SETUP ---
console.log("🔄 Initializing Native WhatsApp Client...");

const AUTH_PATH = '/app/wwebjs_auth';

// CRITICAL FIX: Clean up SingletonLock if it exists from a crashed session
const cleanUpLocks = () => {
    const sessionDir = path.join(AUTH_PATH, 'session');
    if (fs.existsSync(sessionDir)) {
        const lockFile = path.join(sessionDir, 'SingletonLock');
        if (fs.existsSync(lockFile)) {
            console.log("⚠️ Found stale SingletonLock. Removing it to prevent startup crash...");
            try {
                fs.unlinkSync(lockFile);
                console.log("✅ SingletonLock removed.");
            } catch (e) {
                console.error("❌ Failed to remove lock file:", e);
            }
        }
        
        // Also remove SingletonCookie if present (less common but possible)
        const cookieFile = path.join(sessionDir, 'SingletonCookie');
         if (fs.existsSync(cookieFile)) {
            try { fs.unlinkSync(cookieFile); } catch(e) {}
        }
    }
};

cleanUpLocks();

let qrCodeData = null;
let clientStatus = 'INITIALIZING'; // INITIALIZING, QR_READY, AUTHENTICATED, READY, DISCONNECTED

const client = new Client({
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
    // Re-initialize after a delay
    setTimeout(() => {
        console.log('🔄 Re-initializing client...');
        client.initialize().catch(e => console.error("Re-init failed:", e));
    }, 5000);
});

// Initialize safely
try {
    client.initialize().catch(err => {
        console.error("💥 Fatal Client Initialization Error:", err);
    });
} catch (e) {
    console.error("💥 Sync Init Error:", e);
}

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

// 1. SYSTEM STATUS
app.get('/status', (req, res) => {
    res.json({
        status: clientStatus,
        qr: qrCodeData
    });
});

// 2. REGISTER CUSTOMER
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

// 3. GET PENDING
app.get('/get-pending', async (req, res) => {
  try {
    // If DB isn't ready, return empty array instead of crashing
    if (mongoose.connection.readyState !== 1) {
        return res.json([]);
    }
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

// 4. GET FAILED
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

// 5. UPLOAD & SEND (NATIVE)
app.post('/upload-document', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded.' });

  const { requestId, phoneNumber, videoName } = req.body;
  
  // Allow processing if Authenticated OR Ready. Sometimes 'Ready' event lags.
  if (clientStatus !== 'READY' && clientStatus !== 'AUTHENTICATED') {
      if (req.file.path) fs.unlinkSync(req.file.path);
      return res.status(503).json({ error: 'WhatsApp client is not ready. Please scan QR code.' });
  }

  // Immediate Response
  res.json({ success: true, message: 'Processing started' });

  // Background Process
  const filePath = req.file.path;
  const originalName = req.file.originalname;

  try {
    console.log(`🔄 Processing Upload for ID: ${requestId}`);
    
    // 1. Prepare Number
    let cleanPhone = phoneNumber.replace(/[^0-9]/g, '');
    const chatId = `${cleanPhone}@c.us`;

    // 2. Prepare Media
    const media = MessageMedia.fromFilePath(filePath);
    
    // 3. Send Message
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

// Start Server immediately
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Backend (Native WhatsApp) listening on port ${PORT}`);
});
