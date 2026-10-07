/// <reference types="vite/client" />

interface M2ABridge {
  log(message: string): void;
  [key: string]: unknown;
}

declare global {
  interface Window {
    m2a: M2ABridge;
  }
}

export {};
