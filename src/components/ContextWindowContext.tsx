import { createContext, useContext } from 'react';

export const ContextWindowContext = createContext<number | undefined>(undefined);

export function useContextWindow(): number | undefined {
  return useContext(ContextWindowContext);
}
