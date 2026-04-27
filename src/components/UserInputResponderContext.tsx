import React, { createContext, useContext } from 'react';
import type { UserInputResponse } from '@inharness-ai/agent-adapters';

export type UserInputResponder = (
  requestId: string,
  response: UserInputResponse,
) => Promise<void> | void;

const UserInputResponderContext = createContext<UserInputResponder | null>(null);

export function UserInputResponderProvider({
  responder,
  children,
}: {
  responder: UserInputResponder | null;
  children: React.ReactNode;
}) {
  return (
    <UserInputResponderContext.Provider value={responder}>
      {children}
    </UserInputResponderContext.Provider>
  );
}

export function useUserInputResponder(): UserInputResponder | null {
  return useContext(UserInputResponderContext);
}
