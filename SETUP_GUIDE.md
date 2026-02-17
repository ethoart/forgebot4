# 🚀 WhatsDoc Platform (Node.js + WAHA WEBJS)

This version uses a custom Node.js backend and the **WEBJS** engine for WAHA, which supports sending files on the free version.

---

## 🟢 Step 1: Deploy & Reset

Since we switched the WhatsApp engine (NOWEB -> WEBJS), you **must** reset the session.

```bash
# 1. Stop existing containers
docker-compose down

# 2. Run the reset script (Clears old session data)
chmod +x reset_waha.sh
./reset_waha.sh
```

---

## 🔵 Step 2: Scan QR Code

1.  Open **http://<your-server-ip>:3000/dashboard**.
2.  Login with: `admin` / `secret123`.
3.  You will see a session named **`default`**.
4.  **Scan the QR Code** with your WhatsApp app.
5.  Wait for the status to turn **WORKING**.
    *   *Note: WEBJS engine takes 10-20 seconds to start as it launches a real Chrome browser instance.*

---

## 🟠 Step 3: Verify Backend

You can check if the backend is connected to the database by viewing logs:

```bash
docker logs -f backend
```

You should see: `✅ MongoDB Connected`.

---

## 🟣 Done!

*   **App**: `http://<your-server-ip>/`
*   **Admin**: `http://<your-server-ip>/#/admin`
