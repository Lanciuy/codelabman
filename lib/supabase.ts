// 1.1 IMPORT SECTION
import { Platform } from "react-native";
import { createClient } from "@supabase/supabase-js";
import * as SecureStore from "expo-secure-store";

const STORAGE_TIMEOUT_MS = 3000;
const REQUEST_TIMEOUT_MS = 10000;

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`${label} timed out after ${ms}ms`));
    }, ms);

    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      }
    );
  });
}

// 1.2 HARDWARE-ENCRYPTED STORAGE ADAPTER
const ExpoSecureStoreAdapter = {
  getItem: async (key: string): Promise<string | null> => {
    try {
      if (Platform.OS === "web") {
        return typeof localStorage !== "undefined" ? localStorage.getItem(key) : null;
      }
      return await withTimeout(SecureStore.getItemAsync(key), STORAGE_TIMEOUT_MS, "SecureStore.getItem");
    } catch (err) {
      console.warn("SecureStore getItem warning:", err);
      return null;
    }
  },
  setItem: async (key: string, value: string): Promise<void> => {
    try {
      if (Platform.OS === "web") {
        if (typeof localStorage !== "undefined") localStorage.setItem(key, value);
        return;
      }
      await withTimeout(SecureStore.setItemAsync(key, value), STORAGE_TIMEOUT_MS, "SecureStore.setItem");
    } catch (err) {
      console.warn("SecureStore setItem warning:", err);
    }
  },
  removeItem: async (key: string): Promise<void> => {
    try {
      if (Platform.OS === "web") {
        if (typeof localStorage !== "undefined") localStorage.removeItem(key);
        return;
      }
      await withTimeout(SecureStore.deleteItemAsync(key), STORAGE_TIMEOUT_MS, "SecureStore.removeItem");
    } catch (err) {
      console.warn("SecureStore removeItem warning:", err);
    }
  },
};

// Prevent indefinite hanging on stalled mobile sockets or DNS/IPv6 delays
const fetchWithTimeout: typeof fetch = async (input, init) => {
  const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
  const targetUrl = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
  const method = init?.method || "GET";
  const startedAt = Date.now();
  console.log(`[Supabase] -> ${method} ${targetUrl}`);

  if (controller && init?.signal) {
    if (init.signal.aborted) {
      controller.abort();
    } else if (typeof init.signal.addEventListener === "function") {
      init.signal.addEventListener("abort", () => controller.abort());
    }
  }

  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      controller?.abort();
      const abortErr = new Error(`Network request timed out after ${REQUEST_TIMEOUT_MS}ms`);
      abortErr.name = "AbortError";
      reject(abortErr);
    }, REQUEST_TIMEOUT_MS);
  });

  try {
    const fetchPromise = fetch(
      input,
      controller ? { ...init, signal: controller.signal } : init
    );
    const response = await Promise.race([fetchPromise, timeoutPromise]);
    console.log(`[Supabase] <- ${response.status} ${method} (${Date.now() - startedAt}ms)`);
    return response;
  } catch (err: any) {
    console.warn(`[Supabase] !! ${method} failed (${Date.now() - startedAt}ms):`, err?.message || err);
    throw err;
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
};

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL || "";
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || "";

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn("Supabase credentials missing in env file!");
}

// 1.3 INITIALIZE SUPABASE CLIENT SINGLETON
export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  global: {
    fetch: fetchWithTimeout,
  },
  auth: {
    storage: ExpoSecureStoreAdapter,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});

// 1.4 LIVE CLOUD HEALTH CHECK FUNCTION
export async function testCloudBridge(): Promise<boolean> {
  try {
    const { error } = await supabase.from("missions").select("id").limit(1);
    if (!error) console.log("Cloud Bridge: Connection to Supabase established!");
    return true;
  } catch (err) {
    console.error("Cloud Bridge Communication Error:", err);
    return false;
  }
}
