import { createStore, get, getMany, set } from "idb-keyval";
import type { UseStore } from "idb-keyval";

let store: UseStore | undefined;

function getStore() {
  return store ??= createStore("ttt-post-history", "posted-posts");
}

export async function isPostPosted(postId: string): Promise<boolean> {
  return (await get<unknown>(postId, getStore())) !== undefined;
}

export async function recordPostedPost(postId: string): Promise<void> {
  await set(postId, true, getStore());
}

export async function getPostedPostIds(postIds: string[]): Promise<string[]> {
  const posted = await getMany<unknown>(postIds, getStore());
  return postIds.filter((_, index) => posted[index] !== undefined);
}
