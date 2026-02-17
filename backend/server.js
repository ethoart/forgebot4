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
const MONGO_URI = process.env.MONGO_URI || 'mongodb://admin:secret123@mongo:27017';

// --- APP SETUP ---
const app = express();
app.use(cors());
app.use(express.json());

// --- DATABASE ---
mongoose.connect(MONGO_URI)
  .then(() => console.log('✅ MongoDB Connected'))
  .catch(err => console.error('❌ MongoDB Connection Error:', err));

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

// --- WHATSAPP CLIENT SETUP ---
console.log("🔄 Initializing Native WhatsApp Client...");

let qrCodeData = null;
let clientStatus = 'INITIALIZING'; // INITIALIZING, QR_READY, AUTHENTICATED, READY, DISCONNECTED

const client = new Client({
    authStrategy: new LocalAuth({ dataPath: '/app/wwebjs_auth' }),
    puppeteer: {
        headless: true,
        // Use the path defined in Dockerfile env or fallback to standard alpine path
        executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium-browser',
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            '--no-zygote',
            '--disable-gpu'
        ]
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
        client.initialize();
    }, 5000);
});

client.initialize();

// --- FILE UPLOAD ---
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

// 1. SYSTEM STATUS (For Frontend UI)
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
    res.status(500).json({ error: error.message });
  }
});

// 3. GET PENDING
app.get('/get-pending', async (req, res) => {
  try {
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
    res.status(500).json({ error: error.message });
  }
});

// 4. GET FAILED
app.get('/get-failed', async (req, res) => {
  try {
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
  
  if (clientStatus !== 'READY') {
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

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Backend (Native WhatsApp) listening on port ${PORT}`);
});
