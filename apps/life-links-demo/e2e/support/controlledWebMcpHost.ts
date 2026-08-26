import type { Page } from "@playwright/test";

export type ControlledHostSnapshot = {
  activeNames: string[];
  registrationNames: string[];
  abortedNames: string[];
};

export async function installControlledWebMcpHost(page: Page): Promise<void> {
  await page.addInitScript(() => {
    type RegisteredTool = {
      name: string;
      execute(input: unknown, context: { signal?: AbortSignal }): unknown | Promise<unknown>;
    };
    type RegistrationOptions = { signal?: AbortSignal };
    type HostSnapshot = {
      activeNames: string[];
      registrationNames: string[];
      abortedNames: string[];
    };

    const activeTools = new Map<string, RegisteredTool>();
    const registrationNames: string[] = [];
    const abortedNames: string[] = [];
    const modelContext = {
      async registerTool(tool: RegisteredTool, options: RegistrationOptions = {}) {
        if (activeTools.has(tool.name)) {
          throw new Error(`duplicate tool ${tool.name}`);
        }
        registrationNames.push(tool.name);
        activeTools.set(tool.name, tool);
        const unregister = () => {
          if (activeTools.get(tool.name) === tool) {
            activeTools.delete(tool.name);
            abortedNames.push(tool.name);
          }
        };
        if (options.signal?.aborted) {
          unregister();
        } else {
          options.signal?.addEventListener("abort", unregister, { once: true });
        }
      }
    };
    const testHost = {
      snapshot(): HostSnapshot {
        return {
          activeNames: [...activeTools.keys()].sort(),
          registrationNames: [...registrationNames],
          abortedNames: [...abortedNames]
        };
      },
      async invoke(name: string, input: unknown) {
        const tool = activeTools.get(name);
        if (!tool) {
          throw new Error(`Tool ${name} is not active.`);
        }
        const executionController = new AbortController();
        return tool.execute(input, { signal: executionController.signal });
      }
    };

    Object.defineProperty(window, "__lifeLinksControlledWebMcpHost", {
      configurable: false,
      enumerable: false,
      value: testHost
    });
    Object.defineProperty(document, "modelContext", {
      configurable: true,
      enumerable: false,
      value: modelContext
    });
  });
}

export async function controlledHostSnapshot(page: Page): Promise<ControlledHostSnapshot> {
  return page.evaluate(() => {
    const host = (window as unknown as {
      __lifeLinksControlledWebMcpHost: { snapshot(): ControlledHostSnapshot };
    }).__lifeLinksControlledWebMcpHost;
    return host.snapshot();
  });
}

export async function invokeControlledTool(
  page: Page,
  name: string,
  input: unknown
): Promise<Record<string, unknown>> {
  return page.evaluate(
    async ({ toolName, toolInput }) => {
      const host = (window as unknown as {
        __lifeLinksControlledWebMcpHost: { invoke(name: string, input: unknown): Promise<unknown> };
      }).__lifeLinksControlledWebMcpHost;
      return await host.invoke(toolName, toolInput);
    },
    { toolName: name, toolInput: input }
  ) as Promise<Record<string, unknown>>;
}
