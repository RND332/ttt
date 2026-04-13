type RuntimeMessagingApi = {
  sendMessage: (message: unknown) => Promise<unknown> | unknown;
};

export async function sendExtensionMessage<TResponse>(message: unknown): Promise<TResponse> {
  const runtime = getRuntimeMessagingApi();
  if (!runtime) {
    throw new Error("Extension messaging API is unavailable in this context.");
  }

  return (await runtime.sendMessage(message)) as TResponse;
}

function getRuntimeMessagingApi(): RuntimeMessagingApi | undefined {
  const chromeRuntime = (globalThis as typeof globalThis & { chrome?: { runtime?: Partial<RuntimeMessagingApi> } }).chrome?.runtime;
  if (typeof chromeRuntime?.sendMessage === "function") {
    return chromeRuntime as RuntimeMessagingApi;
  }

  const browserRuntime = (globalThis as typeof globalThis & { browser?: { runtime?: Partial<RuntimeMessagingApi> } }).browser?.runtime;
  if (typeof browserRuntime?.sendMessage === "function") {
    return browserRuntime as RuntimeMessagingApi;
  }

  return undefined;
}
