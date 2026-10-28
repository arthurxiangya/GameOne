/** Build-time settings. Vite (and the preview build script) replace `import.meta.env` statically. */
interface ImportMetaEnv {
  readonly VITE_PLAY_MODE?: string;
}

interface ImportMeta {
  readonly env?: ImportMetaEnv;
}
