// Native storage (Metro auto-picks index.web.ts on web — do NOT add Platform.OS checks).
//
// Import the ready-made singleton BY NAME and call methods on it — never a default
// import, never the methods bare:
//   import { storage } from "@/src/utils/storage";
//   await storage.getItem(key, fallback);      // the `fallback` arg is REQUIRED
//
// Namespaces: general KV -> getItem/setItem/removeItem (MMKV, ver abaixo);
//             tokens/secrets -> secureGet/secureSet/secureRemove (Keychain).
// Values are auto JSON-serialized (string|number|boolean|null) in this implementation — never JSON.stringify/parse yourself.
// Helpers NEVER throw: a miss returns `fallback`, a failed write returns `false` (failures are SILENT).
// 
// Use async/await for all storage operations.
//
// AUTH TOKENS: use ONE namespace (secure*) + ONE shared key constant, and read/write it the SAME
// way on both sides — the login/AuthContext (write) and the API client/interceptor (read). A
// mismatched method or key silently returns the fallback, surfacing as a logged-out state or 401/403
// with no error in the logs.
//
// MMKV em vez de AsyncStorage: leitura/escrita síncrona, escrita em C++,
// 10-30x mais rápida — importa bastante em TV box de processador mais
// fraco, onde AsyncStorage (que serializa tudo passando pela ponte
// JS↔nativo) é um gargalo real e silencioso.
//
// MIGRAÇÃO: quem já tinha o app instalado tem tudo salvo no AsyncStorage
// antigo — pra não perder nada, toda LEITURA que não encontra a chave no
// MMKV cai pro AsyncStorage como respaldo, e se achar lá, já copia pro
// MMKV na hora (essa mesma chave nunca mais precisa desse caminho de
// novo). Migração "preguiçosa", por chave, sem precisar de nenhum passo
// especial nem risco de perder tudo de uma vez se algo der errado no meio.

import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";
import { createMMKV, type MMKV } from "react-native-mmkv";

import { AssertNoExtras, StorageBase, StorageItemValue } from "./storage-base";

let _mmkv: MMKV | null = null;
function getMmkv(): MMKV {
  if (!_mmkv) {
    _mmkv = createMMKV({ id: "maximus-kv" });
  }
  return _mmkv;
}

export class Storage extends StorageBase {
  public lastError: unknown = null;
  // General KV — backed by MMKV, com respaldo de leitura no AsyncStorage
  // antigo (ver nota de migração acima).
  async getItem<Fallback extends StorageItemValue>(
    key: string,
    fallback: Fallback,
  ): Promise<Fallback | null> {
    try {
      let raw = getMmkv().getString(key) ?? null;
      if (raw === null) {
        const legacy = await AsyncStorage.getItem(key);
        if (legacy !== null) {
          raw = legacy;
          try {
            getMmkv().set(key, legacy);
          } catch {
            // Falha ao copiar pro MMKV não é motivo pra falhar a leitura —
            // só significa que essa chave tenta migrar de novo na próxima.
          }
        }
      }
      return this.retrieve(raw, fallback);
    } catch (e) {
      this.warn("getItem", key, e);
      return fallback;
    }
  }

  async setItem<Value extends StorageItemValue>(
    key: string,
    value: Value,
  ): Promise<boolean> {
    try {
      getMmkv().set(key, JSON.stringify(value));
      return true;
    } catch (e) {
      this.warn("setItem", key, e);
      this.lastError = e;
      return false;
    }
  }

  async removeItem(key: string): Promise<boolean> {
    try {
      getMmkv().delete(key);
      // Remove do AsyncStorage antigo também, se ainda existir lá — sem
      // isso, uma leitura futura poderia "ressuscitar" um valor apagado
      // (o respaldo de leitura acima acharia ele de novo no AsyncStorage).
      AsyncStorage.removeItem(key).catch(() => {});
      return true;
    } catch (e) {
      this.warn("removeItem", key, e);
      return false;
    }
  }

  // Sensitive values — Keychain (iOS) / EncryptedSharedPreferences (Android).
  // Use these (not getItem) for auth tokens; whatever writes with secureSet must read with secureGet under the same key.
  async secureGet<Fallback extends StorageItemValue>(
    key: string,
    fallback: Fallback,
  ): Promise<Fallback | null> {
    try {
      const raw = await SecureStore.getItemAsync(key);
      return this.retrieve(raw, fallback);
    } catch (e) {
      this.warn("secureGet", key, e);
      return fallback;
    }
  }

  async secureSet<Value extends StorageItemValue>(
    key: string,
    value: Value,
  ): Promise<boolean> {
    try {
      await SecureStore.setItemAsync(key, JSON.stringify(value));
      return true;
    } catch (e) {
      this.warn("secureSet", key, e);
      return false;
    }
  }

  async secureRemove(key: string): Promise<boolean> {
    try {
      await SecureStore.deleteItemAsync(key);
      return true;
    } catch (e) {
      this.warn("secureRemove", key, e);
      return false;
    }
  }
}

// The shared singleton — import THIS (`import { storage } from "@/src/utils/storage"`). Do not `new Storage()`.
export const storage = new Storage();

// Compile-time guard: any new method must be declared in storage-base.ts first.
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- intentional compile-time-only assertion
type _NoExtras = AssertNoExtras<Exclude<keyof Storage, keyof StorageBase>>;