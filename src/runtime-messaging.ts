export async function sendExtensionMessage<TResponse>(message: unknown): Promise<TResponse> {
  const runtime = getRuntimeMessagingApi();
  if (!runtime?.sendMessage) {
    throw new Error("Extension messaging API is unavailable in this context.");
  }

  return (await runtime.sendMessage(message)) as TResponse;
}

function getRuntimeMessagingApi(): { sendMessage?: (message: unknown) => Promise<unknown> | unknown } | undefined {
  const chromeRuntime = (globalThis as typeof globalThis & { chrome?: { runtime?: { sendMessage?: (message: unknown) => Promise<unknown> | unknown } } }).chrome?.runtime;
  if (chromeRuntime?.sendMessage) {
    return chromeRuntime;
  }

  const browserRuntime = (globalThis as typeof globalThis & { browser?: { runtime?: { sendMessage?: (message: unknown) => Promise<unknown> | unknown } } }).browser?.runtime;
  if (browserRuntime?.sendMessage) {
    return browserRuntime;
  }

  return undefined;
}
