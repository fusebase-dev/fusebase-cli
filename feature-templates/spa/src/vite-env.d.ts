/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Optional override for the Fusebase Gate base URL used by the `/link` magic-link route. */
  readonly VITE_FUSEBASE_GATE_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
