import { APP_CONFIG } from '../constants';
import { CustomerRequest } from '../types';

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export interface ServerFile {
  name: string;
  size: string;
  created: string;
}

export interface WhatsAppStatus {
  status: 'INITIALIZING' | 'QR_READY' | 'READY' | 'DISCONNECTED' | 'AUTHENTICATED';
  qr: string | null;
}

// --- API METHODS ---

export const getWhatsAppStatus = async (): Promise<WhatsAppStatus> => {
  if (APP_CONFIG.useMockMode) return { status: 'READY', qr: null };
  try {
    const response = await fetch(`${APP_CONFIG.apiBaseUrl}/status`);
    if (response.ok) return await response.json();
    return { status: 'DISCONNECTED', qr: null };
  } catch (e) {
    return { status: 'DISCONNECTED', qr: null };
  }
};

export const registerCustomer = async (
  name: string,
  phone: string,
  videoName: string
): Promise<boolean> => {
  if (APP_CONFIG.useMockMode) {
    await delay(800);
    return true;
  } else {
    try {
      const response = await fetch(`${APP_CONFIG.apiBaseUrl}/register-customer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, phone, videoName }),
      });
      if (!response.ok) {
        console.error("Register Error:", await response.text());
        return false;
      }
      return true;
    } catch (error) {
      console.error("Network Error", error);
      return false;
    }
  }
};

export const getPendingRequests = async (): Promise<CustomerRequest[]> => {
  if (APP_CONFIG.useMockMode) return [];
  try {
    const response = await fetch(`${APP_CONFIG.apiBaseUrl}/get-pending`);
    if (response.ok) {
       const data = await response.json();
       return data;
    }
    return [];
  } catch (error) {
    console.error("API Error", error);
    return [];
  }
};

export const getFailedRequests = async (): Promise<CustomerRequest[]> => {
  if (APP_CONFIG.useMockMode) return [];
  try {
    const response = await fetch(`${APP_CONFIG.apiBaseUrl}/get-failed`);
    if (response.ok) {
       const data = await response.json();
       return data;
    }
    return [];
  } catch (error) {
    console.error("API Error", error);
    return [];
  }
};

export const uploadDocument = async (
  requestId: string,
  file: File,
  phoneNumber: string
): Promise<boolean> => {
  if (APP_CONFIG.useMockMode) return true;

  if (!requestId || !file || !phoneNumber) {
    return false;
  }

  const formData = new FormData();
  formData.append('requestId', requestId);
  formData.append('phoneNumber', phoneNumber);
  formData.append('videoName', file.name);
  formData.append('file', file);

  try {
    const response = await fetch(`${APP_CONFIG.apiBaseUrl}/upload-document`, {
      method: 'POST',
      body: formData, 
    });
    
    if (!response.ok) {
      console.error("Upload Error:", response.status, await response.text());
      return false;
    }
    return true;
  } catch (error) {
    console.error("Upload Network Error", error);
    return false;
  }
};

export const getServerFiles = async (): Promise<ServerFile[]> => {
  return [];
};

export const deleteServerFile = async (filename: string): Promise<boolean> => {
  return true;
};

export const retryServerFile = async (filename: string): Promise<{success: boolean, message?: string}> => {
  return { success: false, message: "Manual retry not available" };
};
