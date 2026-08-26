import { createContext, useContext, useEffect, useRef, useSyncExternalStore, type ReactNode } from "react";

import { LifeLinksWorkspaceController } from "./controller";
import type { LifeLinksWorkspaceSnapshot } from "./types";

type LifeLinksWorkspaceContextValue = {
  controller: LifeLinksWorkspaceController;
  snapshot: LifeLinksWorkspaceSnapshot;
};

const LifeLinksWorkspaceContext = createContext<LifeLinksWorkspaceContextValue | null>(null);

export function LifeLinksWorkspaceProvider({ children }: { children: ReactNode }) {
  const controllerRef = useRef<LifeLinksWorkspaceController | null>(null);
  if (!controllerRef.current) {
    controllerRef.current = new LifeLinksWorkspaceController();
  }
  const controller = controllerRef.current;
  const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);

  useEffect(() => {
    void controller.start();
    return () => controller.dispose();
  }, [controller]);

  return (
    <LifeLinksWorkspaceContext.Provider value={{ controller, snapshot }}>
      {children}
    </LifeLinksWorkspaceContext.Provider>
  );
}

export function useLifeLinksWorkspace(): LifeLinksWorkspaceContextValue {
  const workspace = useContext(LifeLinksWorkspaceContext);
  if (!workspace) {
    throw new Error("useLifeLinksWorkspace must be used within LifeLinksWorkspaceProvider");
  }
  return workspace;
}
