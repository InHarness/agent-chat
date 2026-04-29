import { useReducer, useCallback } from 'react';
import type { ChatMessage } from '../types.js';
import type { WireEvent } from '../server/protocol.js';
import { messageReducer, createInitialState } from './messageReducer.js';

export { messageReducer, createInitialState } from './messageReducer.js';
export type { MessageAction } from './messageReducer.js';

export function useMessageReducer(architecture: string, model: string) {
  const [state, dispatch] = useReducer(messageReducer, createInitialState(architecture, model));

  const sendUserMessage = useCallback((text: string) => {
    dispatch({ type: 'USER_MESSAGE', text });
  }, []);

  const handleWireEvent = useCallback((event: WireEvent) => {
    dispatch({ type: 'EVENT', event });
  }, []);

  const restoreMessages = useCallback((messages: ChatMessage[], sessionId?: string, arch?: string, mdl?: string) => {
    dispatch({ type: 'RESTORE', messages, sessionId, architecture: arch ?? architecture, model: mdl ?? model });
  }, [architecture, model]);

  const setArchitecture = useCallback((arch: string) => {
    dispatch({ type: 'SET_ARCHITECTURE', architecture: arch });
  }, []);

  const setModel = useCallback((mdl: string) => {
    dispatch({ type: 'SET_MODEL', model: mdl });
  }, []);

  const clear = useCallback(() => {
    dispatch({ type: 'CLEAR' });
  }, []);

  return {
    state,
    sendUserMessage,
    handleWireEvent,
    restoreMessages,
    setArchitecture,
    setModel,
    clear,
  };
}
