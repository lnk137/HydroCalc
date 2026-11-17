export interface Settings {
  language: "zh-CN" | "en-US" | "system";
  theme: "system" | "light" | "dark";
  reduce_motion: boolean;
  method: "auto" | "hsv" | "binary";
  lower_hsv: number[];
  upper_hsv: number[];
  resolution_width: number;
  resolution_height: number;
  soil_width_cm: number;
  soil_height_cm: number;
  start_depth_cm: number;
  matrix_threshold: number;
  depth_threshold: number;
  blur_kernel: number;
  clusters: number;
  enable_clustering: boolean;
  export_include_original: boolean;
}

export interface Analysis {
  effective_method?: "hsv" | "binary";
  id: string;
  name: string;
  created_at: string;
  status: "queued" | "running" | "completed" | "failed";
  stage: string;
  error?: string;
  settings?: Settings;
  metrics?: Record<string, number>;
  profile?: { depth_cm: number; ratio: number }[];
  colors?: Record<string, { color: string; ratio: number; area_cm2: number }[]>;
  source_size?: number[];
}

export interface Bootstrap {
  version: string;
  platform: string;
  data_dir: string;
  configuration_error: string;
  settings: Settings;
  defaults: Settings;
}

declare global {
  interface Window {
    hydrocalc?: {
      exportBatch: (
        ids: string[],
      ) => Promise<{ saved?: boolean; cancelled?: boolean }>;
      exportArtifact: (
        id: string,
        kind: string,
      ) => Promise<{ saved?: boolean; cancelled?: boolean }>;
      openDataDirectory: () => Promise<void>;
      setTheme: (theme: string) => Promise<void>;
      setLanguage: (language: string) => Promise<void>;
    };
  }
}

export interface BatchItem {
  key: number;
  file: File;
  status:
    | "waiting"
    | "uploading"
    | "queued"
    | "running"
    | "completed"
    | "failed"
    | "cancelled";
  id?: string;
  stage?: string;
  error?: string;
  metrics?: Record<string, number>;
}
