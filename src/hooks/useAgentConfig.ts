import { useState, useEffect, useCallback } from 'react';
import type { ServerConfig } from '../server/protocol.js';

export function useAgentConfig(serverUrl: string) {
  const [config, setConfig] = useState<ServerConfig | null>(null);
  const [architecture, setArchitectureState] = useState<string>('');
  const [model, setModelState] = useState<string>('');
  const [defaultCwd, setDefaultCwd] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function fetchConfig() {
      try {
        const res = await fetch(`${serverUrl}/api/config`);
        if (!res.ok) throw new Error(`Failed to fetch config: HTTP ${res.status}`);
        const data: ServerConfig = await res.json();

        if (cancelled) return;
        setConfig(data);
        setArchitectureState(data.defaultArchitecture);
        const archConfig = data.architectures[data.defaultArchitecture];
        setModelState(archConfig?.default ?? archConfig?.models[0] ?? '');
        setDefaultCwd(data.defaultCwd ?? '');
        setError(null);
      } catch (err) {
        if (!cancelled) setError(err as Error);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    fetchConfig();
    return () => { cancelled = true; };
  }, [serverUrl]);

  const setArchitecture = useCallback((arch: string) => {
    setArchitectureState(arch);
    if (config) {
      const archConfig = config.architectures[arch];
      if (archConfig) {
        setModelState(archConfig.default ?? archConfig.models[0] ?? '');
      }
    }
  }, [config]);

  const setModel = useCallback((mdl: string) => {
    setModelState(mdl);
  }, []);

  return {
    config,
    architecture,
    model,
    defaultCwd,
    setArchitecture,
    setModel,
    loading,
    error,
  };
}
