import { APP_CONFIG } from '../constants';
import { CustomerRequest, Event } from '../types';

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export interface ServerFile {
  name: string;
  size: string;
  created: string;
}

export interface WhatsAppStatus {
  status: 'INITIALIZING' | 'QR_READY' | 'READY' | 'DISCONNECTED' | 'AUTHENTICATED';
  qr: string | null;
  queueLength?: number;
}

// --- API METHODS ---

export const login = async (password: string): Promise<boolean> => {
    if (APP_CONFIG.useMockMode) return password === 'secret123';
    try {
        const res = await fetch(`${APP_CONFIG.apiBaseUrl}/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ password })
        });
        return res.ok;
    } catch (e) { return false; }
};

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

// --- EVENTS ---

export const getEvents = async (): Promise<Event[]> => {
    try {
        const res = await fetch(`${APP_CONFIG.apiBaseUrl}/events`);
        return res.ok ? await res.json() : [];
    } catch (e) { return []; }
};

export const createEvent = async (name: string, defaultFileType: 'video' | 'photo'): Promise<Event | null> => {
    try {
        const res = await fetch(`${APP_CONFIG.apiBaseUrl}/create-event`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, defaultFileType })
        });
        return res.ok ? await res.json() : null;
    } catch (e) { return null; }
};

// --- CUSTOMERS ---

export const registerCustomer = async (name: string, phone: string, videoName: string, fileType: 'video' | 'photo', eventId: string): Promise<boolean> => {
    try {
      const response = await fetch(`${APP_CONFIG.apiBaseUrl}/register-customer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, phone, videoName, fileType, eventId }),
      });
      return response.ok;
    } catch (error) { return false; }
};

export const getPendingRequests = async (eventId?: string): Promise<CustomerRequest[]> => {
  try {
    const url = eventId ? `${APP_CONFIG.apiBaseUrl}/get-pending?eventId=${eventId}` : `${APP_CONFIG.apiBaseUrl}/get-pending`;
    const response = await fetch(url);
    return response.ok ? await response.json() : [];
  } catch (error) { return []; }
};

export const getFailedRequests = async (eventId?: string): Promise<CustomerRequest[]> => {
  try {
    const url = eventId ? `${APP_CONFIG.apiBaseUrl}/get-failed?eventId=${eventId}` : `${APP_CONFIG.apiBaseUrl}/get-failed`;
    const response = await fetch(url);
    return response.ok ? await response.json() : [];
  } catch (error) { return []; }
};

export const getCompletedRequests = async (eventId?: string): Promise<CustomerRequest[]> => {
  try {
    const url = eventId ? `${APP_CONFIG.apiBaseUrl}/get-completed?eventId=${eventId}` : `${APP_CONFIG.apiBaseUrl}/get-completed`;
    const response = await fetch(url);
    return response.ok ? await response.json() : [];
  } catch (error) { return []; }
};

// --- FILES ---

export const uploadDocument = async (requestId: string, file: File, phoneNumber: string): Promise<boolean> => {
  const formData = new FormData();
  formData.append('requestId', requestId);
  formData.append('phoneNumber', phoneNumber);
  formData.append('videoName', file.name); // passing filename for loose matching if needed
  formData.append('file', file);

  try {
    const response = await fetch(`${APP_CONFIG.apiBaseUrl}/upload-document`, {
      method: 'POST',
      body: formData, 
    });
    return response.ok;
  } catch (error) { return false; }
};

export const getServerFiles = async (): Promise<ServerFile[]> => {
  try {
      const res = await fetch(`${APP_CONFIG.apiBaseUrl}/server-files`);
      return res.ok ? await res.json() : [];
  } catch (e) { return []; }
};

export const deleteServerFile = async (filename: string): Promise<boolean> => {
  try {
      await fetch(`${APP_CONFIG.apiBaseUrl}/delete-file/${filename}`, { method: 'DELETE' });
      return true;
  } catch (e) { return false; }
};

export const retryServerFile = async (id: string): Promise<{success: boolean, message?: string}> => {
  try {
      const res = await fetch(`${APP_CONFIG.apiBaseUrl}/retry-request/${id}`, { method: 'POST' });
      if (res.ok) return { success: true };
      const data = await res.json();
      return { success: false, message: data.error };
  } catch (e) { return { success: false, message: 'Network error' }; }
};

export const deleteRequest = async (id: string): Promise<boolean> => {
    try {
        await fetch(`${APP_CONFIG.apiBaseUrl}/delete-request/${id}`, { method: 'DELETE' });
        return true;
    } catch (e) { return false; }
};