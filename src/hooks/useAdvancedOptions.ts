import { useCallback, useEffect, useRef, useState } from 'react';
import type { ArchOption } from '@inharness-ai/agent-adapters';

function buildArchDefaults(options: ArchOption[]): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const opt of options) {
    if (opt.default !== undefined) result[opt.key] = opt.default;
  }
  return result;
}

export interface UseAdvancedOptionsParams {
  architecture: string;
  configReady: boolean;
  activeThreadId: string | null;
  getArchOptions: (arch: string) => ArchOption[];
}

export function useAdvancedOptions(params: UseAdvancedOptionsParams) {
  const [cwd, setCwd] = useState('');
  const [activeCwd, setActiveCwd] = useState<string | null>(null);
  const [systemPrompt, setSystemPrompt] = useState('');
  const [maxTurns, setMaxTurns] = useState<number | undefined>(undefined);
  const [architectureConfig, setArchitectureConfig] = useState<Record<string, unknown>>({});
  const [planMode, setPlanMode] = useState(false);

  const { architecture, configReady, activeThreadId, getArchOptions } = params;

  const resetAdvancedOptions = useCallback((archOverride?: string) => {
    setCwd('');
    setActiveCwd(null);
    setSystemPrompt('');
    setMaxTurns(undefined);
    setPlanMode(false);
    const arch = archOverride ?? architecture;
    setArchitectureConfig(buildArchDefaults(getArchOptions(arch)));
  }, [architecture, getArchOptions]);

  // Seed architecture-specific defaults on initial config load (when no thread active).
  const seededInitialRef = useRef(false);
  useEffect(() => {
    if (seededInitialRef.current) return;
    if (!configReady || !architecture) return;
    if (activeThreadId) return;
    seededInitialRef.current = true;
    setArchitectureConfig(buildArchDefaults(getArchOptions(architecture)));
  }, [configReady, architecture, activeThreadId, getArchOptions]);

  return {
    cwd, setCwd,
    activeCwd, setActiveCwd,
    systemPrompt, setSystemPrompt,
    maxTurns, setMaxTurns,
    architectureConfig, setArchitectureConfig,
    planMode, setPlanMode,
    resetAdvancedOptions,
  };
}
